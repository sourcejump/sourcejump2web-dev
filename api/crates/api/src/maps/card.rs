//! Maps' link cards (`map_cards`): the picture a link to a map or one of its runs shows on Discord and elsewhere.
//! `draw.rs` draws them; a job here keeps them current.
//!
//! A card is drawn from the map's cover, name and tier and nothing that changes often, so it stays right and
//! there is one per map, however many links are shared. The job draws a card when a map gets a cover, or its
//! cover or tier in force changes, and deletes the one it replaces; a map whose pictures are all removed loses
//! its card. It sleeps until triggers on those tables wake it (`migrations/0053_map_cards.sql`), then checks
//! every map in one small query and draws only what's out of date. Cards are stored like map pictures, under a name from their content, so caches keep them for good.
//! Pages without a card (maps without a cover, and every other page) show the site's card, which the web app
//! serves itself (`draw::site_card`).

pub mod draw;

use std::{collections::HashSet, fmt::Write, time::Duration};

use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgListener};

use super::{
    image::{LARGE, file_key},
    tiers,
};
use crate::storage::Storage;

/// The channel the triggers notify.
const CHANNEL: &str = "map_cards";
/// A pass without a wake-up, for a notification lost while the listener reconnected.
const FALLBACK: Duration = Duration::from_hours(1);
const LISTEN_RETRY: Duration = Duration::from_secs(5);
/// Raise when `draw.rs` changes how cards look, so every card is drawn again.
const DESIGN: u32 = 1;

/// Runs for as long as the API does. Reconnects on its own.
pub async fn run(db: PgPool, storage: Storage) {
    // Cards that couldn't be drawn, by map and inputs, so a broken cover is reported once rather than on every
    // pass; a new cover or tier tries again.
    let mut failed = HashSet::new();
    loop {
        if let Err(error) = listen(&db, &storage, &mut failed).await {
            tracing::warn!(%error, "map card listener lost; reconnecting");
        }
        tokio::time::sleep(LISTEN_RETRY).await;
    }
}

/// A pass, then another each time a trigger wakes it or the fallback runs out.
async fn listen(
    db: &PgPool,
    storage: &Storage,
    failed: &mut HashSet<(i64, String)>,
) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(db).await?;
    listener.listen(CHANNEL).await?;
    loop {
        // The first pass covers whatever changed while nobody listened: at startup, or before a reconnect.
        if let Err(error) = refresh(db, storage, failed).await {
            tracing::error!(%error, "map card pass failed; trying again on the next change");
        }
        if let Ok(woken) = tokio::time::timeout(FALLBACK, listener.recv()).await {
            woken?;
        }
        // Changes that came in a burst are all covered by the next pass.
        while listener.next_buffered().is_some() {}
    }
}

/// Draws every card that's missing or out of date, and removes those of maps without a cover.
pub async fn refresh(
    db: &PgPool,
    storage: &Storage,
    failed: &mut HashSet<(i64, String)>,
) -> Result<(), sqlx::Error> {
    // Tiers show only once the community has decided a count, as everywhere else.
    let tier_count = tiers::tier_count(db).await?;
    let maps = sqlx::query!(
        r#"
        SELECT m.id AS "id!", m.name AS "name!", i.key AS "cover?", t.tier AS "tier?", c.key AS "card?", c.made_from AS "made_from?"
        FROM maps m
        LEFT JOIN map_images i ON i.map_id = m.id AND i.position = 0
        LEFT JOIN current_map_tiers t ON t.map_id = m.id AND t.track = 0
        LEFT JOIN map_cards c ON c.map_id = m.id
        WHERE i.key IS NOT NULL OR c.map_id IS NOT NULL
        "#
    )
    .fetch_all(db)
    .await?;

    for map in maps {
        let Some(cover) = map.cover else {
            let card = map
                .card
                .expect("the query lists only maps with a cover or a card");
            remove(db, storage, map.id, &card).await?;
            continue;
        };
        let tier = map.tier.filter(|_| tier_count.is_some());
        let made_from = made_from(&cover, tier);
        if map.made_from.as_deref() == Some(made_from.as_str()) {
            continue;
        }
        let attempt = (map.id, made_from);
        if failed.contains(&attempt) {
            continue;
        }
        let made_from = &attempt.1;
        match make(db, storage, map.id, &map.name, &cover, tier, made_from).await {
            Ok(()) => {
                if let Some(old) = map.card {
                    delete_file(storage, &old).await;
                }
            }
            Err(error) => {
                tracing::error!(map = %map.name, %error, "couldn't make the map's card");
                failed.insert(attempt);
            }
        }
    }
    Ok(())
}

/// What a card is drawn from, as stored in `map_cards.made_from`.
fn made_from(cover: &str, tier: Option<i16>) -> String {
    let tier = tier.map_or_else(|| "-".to_owned(), |tier| tier.to_string());
    format!("{DESIGN}/{cover}/{tier}")
}

/// Draws and stores a map's card and records it. Drawing takes a fraction of a second of CPU, so it runs off the
/// async threads.
async fn make(
    db: &PgPool,
    storage: &Storage,
    map_id: i64,
    name: &str,
    cover: &str,
    tier: Option<i16>,
    made_from: &str,
) -> Result<(), String> {
    let picture = storage
        .get(&file_key(cover, LARGE))
        .await
        .map_err(|error| format!("reading the cover: {error}"))?;
    let card = {
        let name = name.to_owned();
        tokio::task::spawn_blocking(move || draw::map_card(&picture, &name, tier))
            .await
            .map_err(|error| format!("drawing: {error}"))??
    };
    let key = format!("maps/{name}/card-{}.jpg", short_hash(&card));
    storage
        .put_immutable(&key, "image/jpeg", None, card)
        .await
        .map_err(|error| format!("storing: {error}"))?;
    sqlx::query!(
        r#"
        INSERT INTO map_cards (map_id, key, made_from) VALUES ($1, $2, $3)
        ON CONFLICT (map_id) DO UPDATE SET key = excluded.key, made_from = excluded.made_from, made_at = now()
        "#,
        map_id,
        key,
        made_from
    )
    .execute(db)
    .await
    .map_err(|error| format!("recording: {error}"))?;
    Ok(())
}

async fn remove(
    db: &PgPool,
    storage: &Storage,
    map_id: i64,
    card: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM map_cards WHERE map_id = $1", map_id)
        .execute(db)
        .await?;
    delete_file(storage, card).await;
    Ok(())
}

/// Deletes a card's file once nothing points at it. A failure leaves an unused file behind, which costs little,
/// so it's logged rather than retried.
async fn delete_file(storage: &Storage, key: &str) {
    if let Err(error) = storage.delete(key).await {
        tracing::warn!(%key, %error, "couldn't delete a replaced map card");
    }
}

/// The first 12 hex digits of the SHA-256, as map pictures are named.
fn short_hash(bytes: &[u8]) -> String {
    let mut hash = String::with_capacity(12);
    for byte in &Sha256::digest(bytes)[..6] {
        write!(hash, "{byte:02x}").expect("writing to a String can't fail");
    }
    hash
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::*;
    use crate::{
        maps::{MapName, image::tests::png},
        staff::{map_images, maps::set_tier},
    };

    const MAP: &str = "bhop_fresh";

    async fn card_of(db: &PgPool) -> Option<(String, String)> {
        sqlx::query!("SELECT c.key, c.made_from FROM map_cards c JOIN maps m ON m.id = c.map_id")
            .fetch_optional(db)
            .await
            .unwrap()
            .map(|row| (row.key, row.made_from))
    }

    fn cards_stored(storage: &Storage) -> Vec<String> {
        let mut keys: Vec<String> = storage
            .objects
            .lock()
            .unwrap()
            .keys()
            .filter(|key| key.contains("/card-"))
            .cloned()
            .collect();
        keys.sort();
        keys
    }

    #[sqlx::test]
    async fn keeps_one_current_card_per_map_with_a_cover(db: PgPool) {
        let storage = Storage::for_tests();
        let mut failed = HashSet::new();
        let map = MapName::try_from(MAP.to_owned()).unwrap();
        sqlx::query!("INSERT INTO maps (name) VALUES ($1)", MAP)
            .execute(&db)
            .await
            .unwrap();

        // No cover, no card.
        refresh(&db, &storage, &mut failed).await.unwrap();
        assert_eq!(card_of(&db).await, None);

        let image = map_images::add_image(&db, &storage, None, &map, png(1920, 1080))
            .await
            .unwrap();
        refresh(&db, &storage, &mut failed).await.unwrap();
        let (first, made_from) = card_of(&db).await.expect("a card for the cover");
        assert!(
            made_from.ends_with("/-"),
            "no tier while tiers aren't decided: {made_from}"
        );
        assert_eq!(cards_stored(&storage), std::slice::from_ref(&first));

        // A tier is published and set.
        sqlx::query!(
            r#"INSERT INTO policies (name, version, value) VALUES ('tiers', 1, '{"count": 6}')"#
        )
        .execute(&db)
        .await
        .unwrap();
        set_tier(&db, None, &map, 0, 3).await.unwrap();
        refresh(&db, &storage, &mut failed).await.unwrap();
        let (second, made_from) = card_of(&db).await.unwrap();
        assert!(made_from.ends_with("/3"), "{made_from}");
        assert_ne!(second, first);
        assert_eq!(
            cards_stored(&storage),
            [second],
            "the replaced card is deleted"
        );

        // Nothing changed: nothing drawn.
        refresh(&db, &storage, &mut failed).await.unwrap();
        assert_eq!(cards_stored(&storage).len(), 1);

        map_images::remove_image(&db, &storage, None, &map, image)
            .await
            .unwrap();
        refresh(&db, &storage, &mut failed).await.unwrap();
        assert_eq!(card_of(&db).await, None);
        assert_eq!(cards_stored(&storage), Vec::<String>::new());
    }

    #[sqlx::test]
    async fn a_cover_that_cant_be_drawn_is_tried_once(db: PgPool) {
        let storage = Storage::for_tests();
        let mut failed = HashSet::new();
        let map = MapName::try_from(MAP.to_owned()).unwrap();
        sqlx::query!("INSERT INTO maps (name) VALUES ($1)", MAP)
            .execute(&db)
            .await
            .unwrap();
        let image = map_images::add_image(&db, &storage, None, &map, png(1920, 1080))
            .await
            .unwrap();
        let key = sqlx::query_scalar!("SELECT key FROM map_images WHERE id = $1", image)
            .fetch_one(&db)
            .await
            .unwrap();
        storage
            .objects
            .lock()
            .unwrap()
            .insert(file_key(&key, LARGE), b"damaged".to_vec());

        refresh(&db, &storage, &mut failed).await.unwrap();
        assert_eq!(card_of(&db).await, None);
        assert_eq!(failed.len(), 1);
    }

    #[sqlx::test]
    async fn cover_and_tier_changes_wake_the_job(db: PgPool) {
        let storage = Storage::for_tests();
        let map = MapName::try_from(MAP.to_owned()).unwrap();
        sqlx::query!("INSERT INTO maps (name) VALUES ($1)", MAP)
            .execute(&db)
            .await
            .unwrap();
        let mut listener = PgListener::connect_with(&db).await.unwrap();
        listener.listen(CHANNEL).await.unwrap();
        let mut woken = async || {
            tokio::time::timeout(Duration::from_secs(5), listener.recv())
                .await
                .is_ok()
        };

        map_images::add_image(&db, &storage, None, &map, png(1920, 1080))
            .await
            .unwrap();
        assert!(woken().await, "a new cover");
        sqlx::query!(
            r#"INSERT INTO policies (name, version, value) VALUES ('tiers', 1, '{"count": 6}')"#
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(woken().await, "a tier count");
        set_tier(&db, None, &map, 0, 3).await.unwrap();
        assert!(woken().await, "a main track's tier");
    }
}
