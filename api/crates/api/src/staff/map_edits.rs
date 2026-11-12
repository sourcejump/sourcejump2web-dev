//! The Discord map-edits feed: a short post when staff change a map's tiers, pictures or zones on the site,
//! so players can follow what changed. The webhook is the secret `SJ_DISCORD_MAP_EDITS`; without it nothing is
//! posted.
//!
//! `log::record` queues each such edit in the transaction that makes it. Edits from the command line (imports
//! of zones or pictures for many maps) aren't queued: they'd flood the channel. One staff member's edits to one
//! map are posted together, once they've stopped editing it for `SETTLE`, so reordering pictures or nudging a
//! zone a few times reads as one change. Like the record feeds, a post is sent before it's deleted from the
//! queue: a crash in between posts it twice, never zero times.

use std::{fmt::Write, time::Duration};

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, types::Json as JsonColumn};
use url::Url;

use super::log::StaffAction;
use crate::{
    maps::image,
    record_events::discord::{
        FeedError, Links, http_client,
        post::{ACCENT, escape, send},
    },
    zones::Zone,
};

/// The feed's name in logs, in place of the webhook.
const FEED: &str = "map edits";
/// How long a staff member's edits to a map must rest before they're posted.
const SETTLE: Duration = Duration::from_secs(120);
const LOOK_AGAIN: Duration = Duration::from_secs(30);
/// How long to wait after Discord or the database failed before trying again.
const RETRY: Duration = Duration::from_secs(60);
/// Zone changes listed in a post before the rest are counted.
const ZONE_CHANGES_LISTED: usize = 6;
/// Longest zone note quoted in a post.
const NOTE_CHARS: usize = 200;

/// Whether an action is one the feed posts.
pub fn feeds(action: StaffAction) -> bool {
    matches!(
        action,
        StaffAction::SetTier
            | StaffAction::AddMapImage
            | StaffAction::RemoveMapImage
            | StaffAction::OrderMapImages
            | StaffAction::SetBannerFocus
            | StaffAction::PublishZones
    )
}

/// Queues a logged edit for the feed, on the transaction that logs it.
pub(super) async fn queue(conn: &mut PgConnection, log_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query!("INSERT INTO discord_map_edits (log_id) VALUES ($1)", log_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// The webhook from `SJ_DISCORD_MAP_EDITS`; None when it's unset.
pub fn webhook_from_env() -> Result<Option<String>, String> {
    let Ok(webhook) = std::env::var("SJ_DISCORD_MAP_EDITS") else {
        return Ok(None);
    };
    // The error never carries the URL: it's a secret.
    match Url::parse(&webhook)
        .map(|url| url.scheme().to_owned())
        .as_deref()
    {
        Ok("https" | "http") => Ok(Some(webhook)),
        _ => Err("SJ_DISCORD_MAP_EDITS must be an http(s) webhook URL".to_owned()),
    }
}

/// Starts the feed, posting for as long as the API runs. Without a webhook it only empties the queue.
pub fn start(db: &PgPool, webhook: Option<String>, links: &Links) {
    let Some(webhook) = webhook else {
        tracing::info!(
            "no Discord map-edits webhook (SJ_DISCORD_MAP_EDITS); map edits aren't posted"
        );
        tokio::spawn(drop_queue(db.clone()));
        return;
    };
    tokio::spawn(run(db.clone(), http_client(), webhook, links.clone()));
}

async fn run(db: PgPool, http: reqwest::Client, webhook: String, links: Links) {
    loop {
        let wait = match post_settled(&db, &http, &webhook, &links, SETTLE).await {
            Ok(()) => LOOK_AGAIN,
            Err(error) => {
                tracing::warn!(feed = FEED, %error, "Discord feed held back; trying again later");
                RETRY
            }
        };
        tokio::time::sleep(wait).await;
    }
}

/// Deletes queued edits every hour, so the queue doesn't grow while no webhook is set. A webhook set later
/// posts edits from then on.
async fn drop_queue(db: PgPool) {
    let mut ticks = tokio::time::interval(Duration::from_hours(1));
    loop {
        ticks.tick().await;
        if let Err(error) = sqlx::query!("DELETE FROM discord_map_edits")
            .execute(&db)
            .await
        {
            tracing::error!(%error, "emptying the map-edits queue failed; trying again later");
        }
    }
}

/// One logged edit, as queued.
#[derive(Debug, Clone)]
struct Edit {
    action: Option<StaffAction>,
    reason: Option<String>,
    detail: Value,
}

/// One staff member's settled edits to one map, posted as one embed.
struct Group {
    map: String,
    actor: i64,
    actor_name: String,
    /// Their Steam avatar, as the site shows it.
    actor_avatar: Option<String>,
    log_ids: Vec<i64>,
    edits: Vec<Edit>,
    last_at: DateTime<Utc>,
}

/// Posts every map's settled edits, oldest first, deleting each group from the queue once it's posted.
async fn post_settled(
    db: &PgPool,
    http: &reqwest::Client,
    webhook: &str,
    links: &Links,
    settle: Duration,
) -> Result<(), FeedError> {
    let mut conn = db.acquire().await?;
    for group in settled(&mut conn, settle).await? {
        let zones = zone_sets(&mut conn, &group).await?;
        let changes = summary(&group.edits, zones.as_ref());
        if !changes.is_empty() {
            let cover = sqlx::query_scalar!(
                "SELECT i.key FROM map_images i JOIN maps m ON m.id = i.map_id
                 WHERE m.name = $1 AND i.position = 0",
                group.map
            )
            .fetch_optional(&mut *conn)
            .await?;
            let mut message = json!({
                "embeds": [embed(&group, &changes, cover.as_deref(), links)],
                "allowed_mentions": { "parse": [] },
            });
            // Posted as the staff member who made the edits, as Discord lets a webhook do per message.
            if let Some(name) = webhook_name(&group.actor_name) {
                message["username"] = json!(name);
            }
            if let Some(avatar) = &group.actor_avatar {
                message["avatar_url"] = json!(avatar);
            }
            send(http, FEED, webhook, &message).await?;
        }
        sqlx::query!(
            "DELETE FROM discord_map_edits WHERE log_id = ANY($1)",
            &group.log_ids
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// The queued edits whose staff member hasn't touched the same map for `settle`, grouped by map and staff
/// member, in the order they began.
async fn settled(conn: &mut PgConnection, settle: Duration) -> Result<Vec<Group>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT q.log_id, l.target AS map, l.actor_steamid64 AS "actor!", p.name AS actor_name, p.avatar_url, l.action,
               l.reason, l.detail, l.at
        FROM discord_map_edits q
        JOIN staff_log l ON l.id = q.log_id
        JOIN players p ON p.steamid64 = l.actor_steamid64
        WHERE NOT EXISTS (
            SELECT 1 FROM discord_map_edits q2 JOIN staff_log l2 ON l2.id = q2.log_id
            WHERE l2.target = l.target AND l2.actor_steamid64 = l.actor_steamid64
              AND l2.at > now() - make_interval(secs => $1)
        )
        ORDER BY l.id
        "#,
        settle.as_secs_f64()
    )
    .fetch_all(conn)
    .await?;

    let mut groups: Vec<Group> = Vec::new();
    for row in rows {
        let edit = Edit {
            action: StaffAction::from_name(&row.action),
            reason: row.reason,
            detail: row.detail,
        };
        match groups
            .iter_mut()
            .find(|group| group.map == row.map && group.actor == row.actor)
        {
            Some(group) => {
                group.log_ids.push(row.log_id);
                group.edits.push(edit);
                group.last_at = row.at;
            }
            None => groups.push(Group {
                map: row.map,
                actor: row.actor,
                actor_name: row.actor_name,
                actor_avatar: row.avatar_url,
                log_ids: vec![row.log_id],
                edits: vec![edit],
                last_at: row.at,
            }),
        }
    }
    Ok(groups)
}

/// A player's name as a message's sender, when Discord takes it. It refuses a message whose name holds
/// "discord" or "clyde" or is "everyone" or "here", which would lose the post, so those post under the
/// webhook's own name instead. Names are cut to Discord's 80 characters.
fn webhook_name(name: &str) -> Option<String> {
    let name: String = name.trim().chars().take(80).collect();
    let lower = name.to_lowercase();
    let refused = name.is_empty()
        || lower.contains("discord")
        || lower.contains("clyde")
        || matches!(lower.as_str(), "everyone" | "here");
    (!refused).then_some(name)
}

/// The zone sets before the group's first zone edit and after its last, when it has any.
async fn zone_sets(
    conn: &mut PgConnection,
    group: &Group,
) -> Result<Option<(Vec<Zone>, Vec<Zone>)>, sqlx::Error> {
    let versions: Vec<i32> = group
        .edits
        .iter()
        .filter(|edit| edit.action == Some(StaffAction::PublishZones))
        .filter_map(|edit| edit.detail["version"].as_i64())
        .filter_map(|version| i32::try_from(version).ok())
        .collect();
    let (Some(first), Some(last)) = (versions.iter().min(), versions.iter().max()) else {
        return Ok(None);
    };
    let rows = sqlx::query!(
        r#"SELECT z.version, z.zones AS "zones: JsonColumn<Vec<Zone>>"
           FROM map_zones z JOIN maps m ON m.id = z.map_id
           WHERE m.name = $1 AND z.version = ANY($2)"#,
        group.map,
        &[first - 1, *last]
    )
    .fetch_all(conn)
    .await?;
    let at = |version: i32| {
        rows.iter()
            .find(|row| row.version == version)
            .map(|row| row.zones.0.clone())
            .unwrap_or_default()
    };
    Ok(Some((at(first - 1), at(*last))))
}

/// What changed, one line per kind of edit: tiers, pictures, zones. Empty when the edits undid themselves.
fn summary(edits: &[Edit], zones: Option<&(Vec<Zone>, Vec<Zone>)>) -> Vec<String> {
    let mut lines = tier_lines(edits);
    if let Some(line) = picture_line(edits) {
        lines.push(line);
    }
    if let Some((before, after)) = zones {
        let notes: Vec<&str> = edits
            .iter()
            .filter(|edit| edit.action == Some(StaffAction::PublishZones))
            .filter_map(|edit| edit.reason.as_deref())
            .collect();
        if let Some(line) = zone_line(before, after, &notes) {
            lines.push(line);
        }
    }
    lines
}

/// Each track whose tier ended up different, from the tier before the first change to the last.
fn tier_lines(edits: &[Edit]) -> Vec<String> {
    // Track → (the tier before, if the log says; the tier after).
    let mut tracks: Vec<(i64, Option<i64>, i64)> = Vec::new();
    for edit in edits
        .iter()
        .filter(|edit| edit.action == Some(StaffAction::SetTier))
    {
        let (Some(track), Some(tier)) =
            (edit.detail["track"].as_i64(), edit.detail["tier"].as_i64())
        else {
            continue;
        };
        match tracks.iter_mut().find(|(t, ..)| *t == track) {
            Some(entry) => entry.2 = tier,
            None => tracks.push((track, edit.detail["previous"].as_i64(), tier)),
        }
    }
    tracks.sort_by_key(|(track, ..)| *track);
    tracks
        .into_iter()
        .filter(|(_, before, after)| *before != Some(*after))
        .map(|(track, before, after)| {
            let whose = if track == 0 {
                "the tier".to_owned()
            } else {
                format!("the Bonus {track} tier")
            };
            match before {
                Some(before) => format!("changed {whose}: T{before} → T{after}"),
                None => format!("set {whose}: T{after}"),
            }
        })
        .collect()
}

fn picture_line(edits: &[Edit]) -> Option<String> {
    let count = |action| {
        edits
            .iter()
            .filter(|edit| edit.action == Some(action))
            .count()
    };
    let pictures = |n: usize| if n == 1 { "picture" } else { "pictures" };
    // Each part as it reads alone, then as it reads in a list after "edited pictures".
    let mut parts: Vec<(String, String)> = Vec::new();
    let added = count(StaffAction::AddMapImage);
    if added > 0 {
        parts.push((
            format!("added {added} {}", pictures(added)),
            format!("added {added}"),
        ));
    }
    let removed = count(StaffAction::RemoveMapImage);
    if removed > 0 {
        parts.push((
            format!("removed {removed} {}", pictures(removed)),
            format!("removed {removed}"),
        ));
    }
    if count(StaffAction::OrderMapImages) > 0 {
        parts.push(("reordered pictures".to_owned(), "reordered".to_owned()));
    }
    if count(StaffAction::SetBannerFocus) > 0 {
        let moved = "moved the banner crop".to_owned();
        parts.push((moved.clone(), moved));
    }
    match parts.as_slice() {
        [] => None,
        [(alone, _)] => Some(alone.clone()),
        _ => {
            let listed: Vec<&str> = parts.iter().map(|(_, listed)| listed.as_str()).collect();
            Some(format!("edited pictures ({})", listed.join(", ")))
        }
    }
}

fn zone_line(before: &[Zone], after: &[Zone], notes: &[&str]) -> Option<String> {
    let changes = zone_changes(before, after);
    let mut line = if before.is_empty() {
        "zoned the map".to_owned()
    } else if changes.is_empty() {
        return None;
    } else {
        let listed = changes.len().min(ZONE_CHANGES_LISTED);
        let mut text = format!("edited zones: {}", changes[..listed].join(", "));
        if changes.len() > listed {
            let _ = write!(text, " and {} more", changes.len() - listed);
        }
        text
    };
    if let Some(note) = notes.last() {
        let mut shown: String = note.chars().take(NOTE_CHARS).collect();
        if note.chars().count() > NOTE_CHARS {
            shown.push('…');
        }
        let _ = write!(line, " · \"{}\"", escape(&shown));
    }
    Some(line)
}

/// Zones grouped by track and type, compared group by group: `added Bonus 1 start`, `changed Main end`.
/// A zone's ID isn't compared, since the editor may number zones afresh.
fn zone_changes(before: &[Zone], after: &[Zone]) -> Vec<String> {
    // Start and end first, as a track reads; other types after, by name.
    let key = |zone: &Zone| {
        let order = match zone.kind.as_str() {
            "start" => 0,
            "end" => 1,
            _ => 2,
        };
        (zone.track, order, zone.kind.clone())
    };
    let mut keys: Vec<_> = before.iter().chain(after).map(key).collect();
    keys.sort();
    keys.dedup();
    let same = |a: &Zone, b: &Zone| {
        Zone {
            id: b.id,
            ..a.clone()
        } == *b
    };

    keys.into_iter()
        .filter_map(|wanted| {
            let was: Vec<&Zone> = before.iter().filter(|z| key(z) == wanted).collect();
            let is: Vec<&Zone> = after.iter().filter(|z| key(z) == wanted).collect();
            let (track, _, kind) = &wanted;
            let track = if *track == 0 {
                "Main".to_owned()
            } else {
                format!("Bonus {track}")
            };
            let label = |n: usize| {
                if n > 1 {
                    format!("{track} {kind} ×{n}")
                } else {
                    format!("{track} {kind}")
                }
            };
            if was.is_empty() {
                Some(format!("added {}", label(is.len())))
            } else if is.is_empty() {
                Some(format!("removed {}", label(was.len())))
            } else if was.len() != is.len() || !was.iter().zip(&is).all(|(a, b)| same(a, b)) {
                Some(format!("changed {}", label(is.len())))
            } else {
                None
            }
        })
        .collect()
}

/// The post: the map on top, linking to its page, each change starting with who made it, and the cover in
/// the corner as the record posts show it.
fn embed(group: &Group, changes: &[String], cover: Option<&str>, links: &Links) -> Value {
    let page = |path: &str| {
        links
            .public_url
            .join(path)
            .map(String::from)
            .unwrap_or_default()
    };
    let who = format!(
        "[{}]({})",
        escape(&group.actor_name),
        page(&format!("players/{}", group.actor))
    );
    let description: Vec<String> = changes.iter().map(|line| format!("{who} {line}")).collect();
    let mut embed = json!({
        "author": { "name": group.map, "url": page(&format!("maps/{}", group.map)) },
        "color": ACCENT,
        "description": description.join("\n"),
        "timestamp": group.last_at.to_rfc3339_opts(SecondsFormat::Secs, true),
    });
    if let Some(key) = cover {
        embed["thumbnail"] =
            json!({ "url": links.storage.public_url(&image::file_key(key, image::SMALL)) });
    }
    embed
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::{Value, json};
    use sqlx::PgPool;
    use url::Url;

    use super::{Edit, picture_line, post_settled, webhook_name, zone_changes};
    use crate::{
        maps::MapName,
        players::SteamId64,
        policies::{self, Policy, TiersPolicy},
        record_events::discord::{Links, tests::fake_webhook},
        staff::{
            log::StaffAction,
            maps::{publish_zones, set_tier},
        },
        storage::Storage,
        zones::Zone,
    };

    const STAFF: &str = "76561197960287930";

    fn zone(kind: &str, track: i32, id: i64, x: f64) -> Zone {
        serde_json::from_value(json!({
            "type": kind, "track": track, "id": id,
            "point_a": [x, 0.0, 0.0], "point_b": [x + 64.0, 64.0, 64.0],
        }))
        .unwrap()
    }

    async fn staff(db: &PgPool) -> SteamId64 {
        sqlx::query("INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1::bigint, 'zoner', now())")
            .bind(STAFF)
            .execute(db)
            .await
            .unwrap();
        SteamId64::parse_any(STAFF).unwrap()
    }

    async fn post(db: &PgPool, settle: Duration, webhook: &Url) {
        let links = Links {
            public_url: Url::parse("https://sourcejump.test/").unwrap(),
            storage: Storage::for_tests(),
        };
        post_settled(
            db,
            &reqwest::Client::new(),
            webhook.as_str(),
            &links,
            settle,
        )
        .await
        .unwrap();
    }

    fn descriptions(received: &std::sync::Mutex<Vec<Value>>) -> Vec<String> {
        received
            .lock()
            .unwrap()
            .iter()
            .map(|message| {
                message["embeds"][0]["description"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect()
    }

    #[sqlx::test]
    async fn a_staff_members_edits_to_a_map_are_posted_together_once_settled(db: PgPool) {
        let actor = staff(&db).await;
        let map = MapName::try_from("bhop_badges".to_owned()).unwrap();
        policies::publish(
            &mut db.acquire().await.unwrap(),
            &Policy::Tiers(TiersPolicy { count: 6 }),
        )
        .await
        .unwrap();
        let first = [zone("start", 0, 1, 0.0), zone("end", 0, 2, 1000.0)];
        publish_zones(&db, None, &map, None, &first, None)
            .await
            .unwrap();
        // The command line's edits aren't posted.
        set_tier(&db, None, &map, 0, 1).await.unwrap();

        set_tier(&db, Some(actor), &map, 0, 3).await.unwrap();
        set_tier(&db, Some(actor), &map, 0, 5).await.unwrap();
        set_tier(&db, Some(actor), &map, 1, 2).await.unwrap();
        let second = [
            zone("start", 0, 1, 0.0),
            zone("end", 0, 2, 900.0),
            zone("start", 1, 3, 5000.0),
        ];
        publish_zones(
            &db,
            Some(actor),
            &map,
            Some(1),
            &second,
            Some("end moved back"),
        )
        .await
        .unwrap();

        let (webhook, received) = fake_webhook().await;
        post(&db, Duration::from_hours(1), &webhook).await;
        assert!(received.lock().unwrap().is_empty(), "still being edited");
        post(&db, Duration::ZERO, &webhook).await;
        post(&db, Duration::ZERO, &webhook).await;

        let link = "[zoner](https://sourcejump.test/players/76561197960287930)";
        assert_eq!(
            descriptions(&received),
            [format!(
                "{link} changed the tier: T1 → T5\n\
                 {link} set the Bonus 1 tier: T2\n\
                 {link} edited zones: changed Main end, added Bonus 1 start · \"end moved back\""
            )]
        );
        let message = &received.lock().unwrap()[0];
        assert_eq!(message["username"], "zoner");
        assert_eq!(message["embeds"][0]["author"]["name"], "bhop_badges");
        assert_eq!(
            message["embeds"][0]["author"]["url"],
            "https://sourcejump.test/maps/bhop_badges"
        );
    }

    #[sqlx::test]
    async fn a_tier_changed_and_changed_back_is_not_posted(db: PgPool) {
        let actor = staff(&db).await;
        let map = MapName::try_from("bhop_badges".to_owned()).unwrap();
        crate::maps::id_for(&mut db.acquire().await.unwrap(), &map)
            .await
            .unwrap();
        policies::publish(
            &mut db.acquire().await.unwrap(),
            &Policy::Tiers(TiersPolicy { count: 6 }),
        )
        .await
        .unwrap();
        set_tier(&db, None, &map, 0, 2).await.unwrap();
        set_tier(&db, Some(actor), &map, 0, 4).await.unwrap();
        set_tier(&db, Some(actor), &map, 0, 2).await.unwrap();

        let (webhook, received) = fake_webhook().await;
        post(&db, Duration::ZERO, &webhook).await;

        assert!(received.lock().unwrap().is_empty());
        let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM discord_map_edits")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(queued, 0);
    }

    #[test]
    fn names_discord_refuses_post_under_the_webhooks_own() {
        assert_eq!(webhook_name(" nova ").as_deref(), Some("nova"));
        assert_eq!(webhook_name("my Discord"), None);
        assert_eq!(webhook_name("Clyde"), None);
        assert_eq!(webhook_name("everyone"), None);
        assert_eq!(webhook_name(""), None);
        assert_eq!(webhook_name(&"x".repeat(100)).unwrap().len(), 80);
    }

    #[test]
    fn picture_edits_read_briefly() {
        let edit = |action| Edit {
            action: Some(action),
            reason: None,
            detail: json!({}),
        };
        let line = |actions: &[StaffAction]| {
            picture_line(&actions.iter().map(|a| edit(*a)).collect::<Vec<_>>())
        };
        assert_eq!(line(&[]), None);
        assert_eq!(
            line(&[StaffAction::OrderMapImages]).unwrap(),
            "reordered pictures"
        );
        assert_eq!(
            line(&[StaffAction::AddMapImage]).unwrap(),
            "added 1 picture"
        );
        assert_eq!(
            line(&[StaffAction::RemoveMapImage, StaffAction::RemoveMapImage]).unwrap(),
            "removed 2 pictures"
        );
        assert_eq!(
            line(&[
                StaffAction::AddMapImage,
                StaffAction::OrderMapImages,
                StaffAction::OrderMapImages
            ])
            .unwrap(),
            "edited pictures (added 1, reordered)"
        );
    }

    #[test]
    fn zone_changes_ignore_renumbering() {
        let before = [zone("start", 0, 1, 0.0), zone("teleport", 0, 2, 50.0)];
        let renumbered = [zone("start", 0, 7, 0.0), zone("teleport", 0, 8, 50.0)];
        assert_eq!(zone_changes(&before, &renumbered), Vec::<String>::new());
        let after = [
            zone("start", 0, 1, 0.0),
            zone("teleport", 0, 2, 50.0),
            zone("teleport", 0, 3, 90.0),
        ];
        assert_eq!(zone_changes(&before, &after), ["changed Main teleport ×2"]);
        assert_eq!(zone_changes(&after, &[]).len(), 2);
    }
}
