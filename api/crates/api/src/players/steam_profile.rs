//! A player's public Steam profile: name, avatar and country, read from `steamcommunity.com/profiles/{id}/?xml=1`.
//!
//! The lead chose this over the Steam Web API, so no Steam key is needed. The XML is Steam's community page in
//! another form; it has no published contract, so anything unexpected leaves our copy as it was.

use std::time::Duration as StdDuration;

use chrono::{Duration, Utc};
use quick_xml::{Reader, escape::unescape, events::Event};
use sqlx::PgPool;

use super::{SteamId64, countries};
use crate::steam::Steam;

/// How long a fetched profile is fresh. Older copies are refreshed when the profile is viewed.
const FRESH_FOR: Duration = Duration::days(1);
/// After a failed fetch, how long until a view tries again. Without it every view of the profile would queue
/// another request to Steam, which is most likely refusing them already.
const RETRY_AFTER: Duration = Duration::hours(1);
/// Steam rate-limits community pages per IP without saying how hard, so fetches keep at least this gap.
const MIN_GAP: StdDuration = StdDuration::from_secs(2);
/// At most this many refreshes wait their turn; more are dropped, and a later view asks again. With `MIN_GAP`,
/// the last in line waits under two minutes however many profiles are viewed.
const MAX_QUEUED: usize = 50;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SteamProfile {
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub country_code: Option<&'static str>,
}

#[derive(Debug)]
pub enum FetchError {
    Http(reqwest::Error),
    Status(u16),
    /// Steam answered, but not with a profile (no such account, or an error page).
    NotAProfile,
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(error) => write!(f, "request failed: {error}"),
            Self::Status(status) => write!(f, "Steam answered {status}"),
            Self::NotAProfile => f.write_str("Steam's answer isn't a profile"),
        }
    }
}

/// Reads the profile document. Only `<profile>`'s own fields count: groups further down have avatars too.
pub fn parse(xml: &str) -> Result<SteamProfile, FetchError> {
    let mut reader = Reader::from_str(xml);
    let mut profile = SteamProfile::default();
    let mut path: Vec<String> = Vec::new();
    let mut saw_profile = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(tag)) => {
                path.push(tag.name().as_ref().to_owned());
                saw_profile |= path.len() == 1 && path[0] == "profile";
            }
            Ok(Event::End(_)) => {
                path.pop();
            }
            Ok(Event::CData(text)) => {
                read_field(&path, text.into_inner().trim().to_owned(), &mut profile);
            }
            Ok(Event::Text(text)) => {
                if let Ok(text) = unescape(&text.into_inner()) {
                    read_field(&path, text.trim().to_owned(), &mut profile);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err(FetchError::NotAProfile),
        }
    }
    if saw_profile {
        Ok(profile)
    } else {
        Err(FetchError::NotAProfile)
    }
}

fn read_field(path: &[String], text: String, profile: &mut SteamProfile) {
    let [root, field] = path else { return };
    if root != "profile" || text.is_empty() {
        return;
    }
    match field.as_str() {
        "steamID" => profile.name = Some(text),
        "avatarFull" if text.starts_with("https://") => profile.avatar_url = Some(text),
        "location" => profile.country_code = countries::code_for_location(&text),
        _ => {}
    }
}

pub async fn fetch(steam: &Steam, steamid64: SteamId64) -> Result<SteamProfile, FetchError> {
    steam.wait_for_turn(MIN_GAP).await;
    let url = steam
        .community
        .join(&format!("profiles/{steamid64}/?xml=1"))
        .expect("a valid path");
    let response = steam.http.get(url).send().await.map_err(FetchError::Http)?;
    if !response.status().is_success() {
        return Err(FetchError::Status(response.status().as_u16()));
    }
    parse(&response.text().await.map_err(FetchError::Http)?)
}

/// Fetches the profile and stores it. The Steam name is used only while no run has given the player a name:
/// on SourceJump, the name players see is the one they play under.
pub async fn refresh(db: &PgPool, steam: &Steam, steamid64: SteamId64) -> Result<(), sqlx::Error> {
    let profile = match fetch(steam, steamid64).await {
        Ok(profile) => profile,
        Err(error) => {
            tracing::warn!(%steamid64, %error, "couldn't fetch a Steam profile");
            // Our copy stays as it was, dated so that it goes stale again in `RETRY_AFTER`.
            sqlx::query!(
                "UPDATE players SET steam_profile_fetched_at = $2 WHERE steamid64 = $1",
                steamid64.get(),
                Utc::now() - (FRESH_FOR - RETRY_AFTER)
            )
            .execute(db)
            .await?;
            return Ok(());
        }
    };
    sqlx::query!(
        r#"
        UPDATE players SET
            avatar_url = $2,
            -- A country the player picked on their profile stays.
            country_code = CASE WHEN country_chosen THEN country_code ELSE $3 END,
            steam_profile_fetched_at = now(),
            name = CASE WHEN name_seen_at = '-infinity' AND $4::text IS NOT NULL THEN $4 ELSE name END
        WHERE steamid64 = $1
        "#,
        steamid64.get(),
        profile.avatar_url,
        profile.country_code,
        profile.name
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Refreshes the profile in the background if our copy is missing or a day old. The caller doesn't wait:
/// pages show what we have, and the next view shows the update.
pub fn refresh_if_stale(
    db: PgPool,
    steam: Steam,
    steamid64: SteamId64,
    fetched_at: Option<chrono::DateTime<Utc>>,
) {
    if fetched_at.is_some_and(|fetched| Utc::now() - fetched < FRESH_FOR) {
        return;
    }
    spawn_refresh(db, steam, steamid64);
}

/// Fetches the profile in the background if it has never been fetched, for a player who just sent a run.
/// Without this, a player who only plays would have no avatar until someone opens their profile. Profiles
/// fetched before (successfully or not) are left to views, so regulars cost Steam nothing. If the line is full
/// or the API restarts first, the player is still unfetched and their next run asks again. True when queued.
pub async fn refresh_if_never_fetched(
    db: &PgPool,
    steam: &Steam,
    steamid64: SteamId64,
) -> Result<bool, sqlx::Error> {
    let never_fetched = sqlx::query_scalar!(
        "SELECT steam_profile_fetched_at IS NULL AS \"never!\" FROM players WHERE steamid64 = $1",
        steamid64.get()
    )
    .fetch_optional(db)
    .await?
    .unwrap_or(false);
    Ok(never_fetched && spawn_refresh(db.clone(), steam.clone(), steamid64))
}

/// Queues the refresh and runs it once its turn comes. False when it couldn't be queued (see `queue`).
fn spawn_refresh(db: PgPool, steam: Steam, steamid64: SteamId64) -> bool {
    if !queue(&steam, steamid64) {
        return false;
    }
    tokio::spawn(async move {
        if let Err(error) = refresh(&db, &steam, steamid64).await {
            tracing::error!(%steamid64, %error, "couldn't store a Steam profile");
        }
        lock_queue(&steam).remove(&steamid64);
    });
    true
}

/// Takes a place in line for the player's refresh. False when one is already queued for them, or the line is
/// full: views of a stale profile, or a crawler walking every profile, can't queue hours of Steam requests.
fn queue(steam: &Steam, steamid64: SteamId64) -> bool {
    let mut queued = lock_queue(steam);
    queued.len() < MAX_QUEUED && queued.insert(steamid64)
}

fn lock_queue(steam: &Steam) -> std::sync::MutexGuard<'_, std::collections::HashSet<SteamId64>> {
    // Only inserts and removes happen under the lock, which can't panic, so it's never poisoned.
    steam.profile_refreshes.lock().expect("never poisoned")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped like Steam's response, with invented values.
    const PUBLIC: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
        <steamID64>76561197960287930</steamID64>
        <steamID><![CDATA[nova]]></steamID>
        <privacyState>public</privacyState>
        <avatarMedium><![CDATA[https://avatars.example/abc_medium.jpg]]></avatarMedium>
        <avatarFull><![CDATA[https://avatars.example/abc_full.jpg]]></avatarFull>
        <location><![CDATA[Bergen, Hordaland, Norway]]></location>
        <groups><group isPrimary="1">
            <avatarFull><![CDATA[https://avatars.example/group_full.jpg]]></avatarFull>
            <location><![CDATA[Sweden]]></location>
        </group></groups>
    </profile>"#;

    #[test]
    fn one_refresh_per_player_and_a_bounded_line() {
        let steam = Steam::new();
        let first = SteamId64::parse_any("76561197960287930").unwrap();
        assert!(queue(&steam, first));
        assert!(!queue(&steam, first), "already queued");
        for account in 1..u32::try_from(MAX_QUEUED).unwrap() {
            assert!(queue(
                &steam,
                SteamId64::parse_any(&format!("[U:1:{account}]")).unwrap()
            ));
        }
        assert!(
            !queue(&steam, SteamId64::parse_any("[U:1:999999]").unwrap()),
            "line full"
        );
        lock_queue(&steam).remove(&first);
        assert!(queue(&steam, first), "a finished refresh frees its place");
    }

    #[sqlx::test]
    async fn a_run_fetches_only_profiles_never_fetched(db: PgPool) {
        let steam = Steam::with_base(&url::Url::parse("http://127.0.0.1:9/").unwrap());
        let (new, known, missing) = (
            SteamId64::parse_any("[U:1:1]").unwrap(),
            SteamId64::parse_any("[U:1:2]").unwrap(),
            SteamId64::parse_any("[U:1:3]").unwrap(),
        );
        sqlx::query(
            "INSERT INTO players (steamid64, name, name_seen_at, steam_profile_fetched_at)
             VALUES ($1, 'new', '-infinity', NULL), ($2, 'known', '-infinity', '2020-01-01Z')",
        )
        .bind(new.get())
        .bind(known.get())
        .execute(&db)
        .await
        .unwrap();

        assert!(refresh_if_never_fetched(&db, &steam, new).await.unwrap());
        assert!(
            !refresh_if_never_fetched(&db, &steam, known).await.unwrap(),
            "fetched before, even long ago: left to profile views"
        );
        assert!(
            !refresh_if_never_fetched(&db, &steam, missing)
                .await
                .unwrap()
        );
    }

    #[sqlx::test]
    async fn a_failed_fetch_waits_before_trying_again(db: PgPool) {
        let steamid64 = SteamId64::parse_any("76561197960287930").unwrap();
        sqlx::query(
            "INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1, 'nova', '-infinity')",
        )
        .bind(steamid64.get())
        .execute(&db)
        .await
        .unwrap();
        // Nothing listens on the discard port, so the fetch fails.
        let steam = Steam::with_base(&url::Url::parse("http://127.0.0.1:9/").unwrap());
        refresh(&db, &steam, steamid64).await.unwrap();

        let (name, fetched_at): (String, chrono::DateTime<Utc>) = sqlx::query_as(
            "SELECT name, steam_profile_fetched_at FROM players WHERE steamid64 = $1",
        )
        .bind(steamid64.get())
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(name, "nova", "the profile stays as it was");
        let stale_in = fetched_at + FRESH_FOR - Utc::now();
        assert!(
            stale_in > RETRY_AFTER - Duration::minutes(1) && stale_in <= RETRY_AFTER,
            "goes stale again in an hour, not at once: {stale_in}"
        );
    }

    #[test]
    fn reads_name_avatar_and_country() {
        assert_eq!(
            parse(PUBLIC).unwrap(),
            SteamProfile {
                name: Some("nova".to_owned()),
                avatar_url: Some("https://avatars.example/abc_full.jpg".to_owned()),
                country_code: Some("NO"),
            }
        );
    }

    #[test]
    fn a_private_profile_still_has_a_name_and_avatar() {
        let private = r"<profile><steamID><![CDATA[ricochet]]></steamID><privacyState>private</privacyState>
            <avatarFull><![CDATA[https://avatars.example/r_full.jpg]]></avatarFull></profile>";
        let profile = parse(private).unwrap();
        assert_eq!(profile.name.as_deref(), Some("ricochet"));
        assert_eq!(profile.country_code, None);
    }

    #[test]
    fn an_error_page_is_not_a_profile() {
        let missing = "<response><error><![CDATA[The specified profile could not be found.]]></error></response>";
        assert!(matches!(parse(missing), Err(FetchError::NotAProfile)));
        assert!(matches!(parse("<html>busy"), Err(FetchError::NotAProfile)));
    }

    #[test]
    fn avatars_must_be_https() {
        let profile =
            parse(r"<profile><avatarFull>http://avatars.example/a.jpg</avatarFull></profile>")
                .unwrap();
        assert_eq!(profile.avatar_url, None);
    }
}
