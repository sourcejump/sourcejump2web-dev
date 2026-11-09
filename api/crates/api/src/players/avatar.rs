//! A player's picture, `GET /v1/players/{player}/avatar`: a redirect to their Steam avatar, fetched on the spot
//! when we have none yet, or a lettered placeholder. Pages point `<img>` here for players whose `avatar_url` is
//! empty, so everyone shown gets a picture without having signed in or opened their profile.

use axum::{
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use url::Url;

use super::{SteamId64, steam_profile};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
};

/// Steam avatar URLs don't change for the same picture, so a day in caches costs nothing.
const AVATAR_CACHE: &str = "public, max-age=86400";
/// Short, so the real picture replaces the placeholder soon after a background refresh finds it.
const PLACEHOLDER_CACHE: &str = "public, max-age=300";

/// Redirects to the player's Steam avatar. Takes a `SteamID64`, `SteamID2` or `SteamID3`. Only players
/// SourceJump knows are looked up on Steam; a player known only from the old site gets the avatar it had.
#[utoipa::path(
    get,
    path = "/v1/players/{player}/avatar",
    tag = "players",
    params(("player" = String, Path, description = "SteamID64, SteamID2 (STEAM_0:1:2) or SteamID3 ([U:1:4])")),
    responses(
        (status = FOUND, description = "To the avatar on Steam's CDN; cached a day",
            headers(("Location" = String, description = "The avatar's URL"))),
        (status = OK, description = "No avatar yet: a placeholder with the player's initials, cached five minutes",
            content_type = "image/svg+xml", body = String),
        (status = NOT_FOUND, description = "SourceJump has no such player", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID", body = ErrorBody),
    ),
)]
pub async fn player_avatar(
    State(state): State<AppState>,
    Path(player): Path<String>,
) -> Result<Response, ApiError> {
    let steamid64 = SteamId64::parse_any(&player)
        .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID")))?;

    let player = sqlx::query!(
        "SELECT name, avatar_url, steam_profile_fetched_at FROM players WHERE steamid64 = $1",
        steamid64.get()
    )
    .fetch_optional(&state.db)
    .await?;
    let Some(player) = player else {
        // Never fetched: with no `players` row there is nowhere to store the profile or a failure, so every
        // request would ask Steam again. Making a row here would turn their legacy profile into a 2.0 one.
        let legacy = sqlx::query!(
            "SELECT name, avatar_url FROM legacy_players WHERE steamid64 = $1",
            steamid64.get()
        )
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound("SourceJump has no such player"))?;
        return Ok(picture(legacy.avatar_url.as_deref(), &legacy.name));
    };

    if player.avatar_url.is_some() || steam_profile::is_fresh(player.steam_profile_fetched_at) {
        // The picture we have, or a placeholder while Steam recently had none or failed (`RETRY_AFTER`).
        steam_profile::refresh_if_stale(
            state.db.clone(),
            state.steam.clone(),
            steamid64,
            player.steam_profile_fetched_at,
        );
        return Ok(picture(player.avatar_url.as_deref(), &player.name));
    }
    if !steam_profile::refresh_now(&state.db, &state.steam, steamid64).await? {
        // Every slot is busy: the placeholder now, and the paced queue fetches it for the next request.
        steam_profile::refresh_if_stale(
            state.db.clone(),
            state.steam.clone(),
            steamid64,
            player.steam_profile_fetched_at,
        );
        return Ok(picture(None, &player.name));
    }
    let stored = sqlx::query!(
        "SELECT name, avatar_url FROM players WHERE steamid64 = $1",
        steamid64.get()
    )
    .fetch_one(&state.db)
    .await?;
    Ok(picture(stored.avatar_url.as_deref(), &stored.name))
}

/// A redirect to `avatar_url` if it's on Steam's CDN, else the placeholder.
fn picture(avatar_url: Option<&str>, name: &str) -> Response {
    match avatar_url.and_then(steam_cdn_url) {
        Some(url) => (
            StatusCode::FOUND,
            [
                (header::LOCATION, url.to_string()),
                (header::CACHE_CONTROL, AVATAR_CACHE.to_owned()),
            ],
        )
            .into_response(),
        None => (
            [
                (header::CONTENT_TYPE, "image/svg+xml"),
                (header::CACHE_CONTROL, PLACEHOLDER_CACHE),
            ],
            placeholder(name),
        )
            .into_response(),
    }
}

/// The URL, if it's an `https` address on Steam's avatar CDN. Stored URLs come from Steam's XML, which has no
/// contract, and from the old site's data; checking keeps this route from redirecting anywhere else.
fn steam_cdn_url(text: &str) -> Option<Url> {
    let url = Url::parse(text).ok()?;
    let host = url.host_str()?;
    let on_cdn = host == "steamcdn-a.akamaihd.net"
        || host == "steamstatic.com"
        || host.ends_with(".steamstatic.com");
    let plain = url.username().is_empty() && url.password().is_none() && url.port().is_none();
    (url.scheme() == "https" && on_cdn && plain).then_some(url)
}

/// A square with the player's initials, in the site's raised-surface and muted-text colours (`web/src/ui/tokens.css`),
/// matching the web's `Avatar` fallback.
fn placeholder(name: &str) -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#29354b"/><text x="32" y="32" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#9db0cc">{}</text></svg>"##,
        initials(name)
    )
}

/// The first letter or digit of the first two words, as the web's `Avatar` does: "strafe cat" is "SC". Letters
/// and digits only, so the player's name can't put markup in the SVG.
fn initials(name: &str) -> String {
    let letters: String = name
        .split(|c: char| c.is_whitespace() || matches!(c, '_' | '.' | '-'))
        .filter_map(|word| word.chars().find(|c| c.is_alphanumeric()))
        .take(2)
        .flat_map(char::to_uppercase)
        .collect();
    if letters.is_empty() {
        "?".to_owned()
    } else {
        letters
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use axum::{body::Body, http::Request};
    use sqlx::PgPool;

    use super::*;
    use crate::{
        players::steam_profile::tests::stand_in_steam,
        test_client::{self, TestResponse},
    };

    const PLAYER: &str = "76561197960287930";
    const AVATAR: &str = "https://avatars.steamstatic.com/abc_full.jpg";
    const PROFILE: &str = r"<profile><steamID><![CDATA[nova]]></steamID>
        <avatarFull><![CDATA[https://avatars.steamstatic.com/abc_full.jpg]]></avatarFull></profile>";

    async fn add_player(db: &PgPool, avatar_url: Option<&str>, fetched_hours_ago: Option<i64>) {
        sqlx::query(
            "INSERT INTO players (steamid64, name, name_seen_at, avatar_url, steam_profile_fetched_at)
             VALUES ($1, 'strafe cat', now(), $2, now() - make_interval(hours => $3::int))",
        )
        .bind(SteamId64::parse_any(PLAYER).unwrap().get())
        .bind(avatar_url)
        .bind(fetched_hours_ago.map(|hours| i32::try_from(hours).unwrap()))
        .execute(db)
        .await
        .unwrap();
    }

    async fn avatar(state: &AppState, player: &str) -> TestResponse {
        let request = Request::get(format!("/v1/players/{player}/avatar"))
            .body(Body::empty())
            .unwrap();
        test_client::send_to(state.clone(), request).await
    }

    fn with_steam(db: &PgPool, steam: crate::steam::Steam) -> AppState {
        AppState {
            steam,
            ..AppState::for_tests(db.clone())
        }
    }

    fn assert_placeholder(response: &TestResponse) {
        assert_eq!(response.status, 200);
        assert_eq!(response.headers[header::CONTENT_TYPE], "image/svg+xml");
        assert_eq!(response.headers[header::CACHE_CONTROL], PLACEHOLDER_CACHE);
        assert!(String::from_utf8_lossy(&response.body).contains(">SC</text>"));
    }

    #[sqlx::test]
    async fn a_fresh_avatar_is_a_redirect(db: PgPool) {
        add_player(&db, Some(AVATAR), Some(1)).await;
        let (steam, requests) = stand_in_steam(StatusCode::OK, PROFILE).await;

        let response = avatar(&with_steam(&db, steam), "[U:1:22202]").await;
        assert_eq!(response.status, 302);
        assert_eq!(response.headers[header::LOCATION], AVATAR);
        assert_eq!(response.headers[header::CACHE_CONTROL], AVATAR_CACHE);
        assert_eq!(
            requests.load(Ordering::SeqCst),
            0,
            "fresh: Steam isn't asked"
        );
    }

    #[sqlx::test]
    async fn an_unknown_player_is_never_looked_up(db: PgPool) {
        let (steam, requests) = stand_in_steam(StatusCode::OK, PROFILE).await;

        let response = avatar(&with_steam(&db, steam), PLAYER).await;
        assert_eq!(response.status, 404);
        assert_eq!(requests.load(Ordering::SeqCst), 0);
        assert_eq!(avatar(&AppState::for_tests(db), "nova").await.status, 422);
    }

    #[sqlx::test]
    async fn a_missing_avatar_is_fetched_and_stored(db: PgPool) {
        add_player(&db, None, None).await;
        let (steam, requests) = stand_in_steam(StatusCode::OK, PROFILE).await;

        let response = avatar(&with_steam(&db, steam), PLAYER).await;
        assert_eq!(response.status, 302);
        assert_eq!(response.headers[header::LOCATION], AVATAR);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        let stored: Option<String> =
            sqlx::query_scalar("SELECT avatar_url FROM players WHERE steamid64 = $1")
                .bind(SteamId64::parse_any(PLAYER).unwrap().get())
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(stored.as_deref(), Some(AVATAR));
    }

    #[sqlx::test]
    async fn a_failed_fetch_shows_the_placeholder_and_waits(db: PgPool) {
        add_player(&db, None, None).await;
        let (steam, requests) = stand_in_steam(StatusCode::SERVICE_UNAVAILABLE, "busy").await;
        let state = with_steam(&db, steam);

        assert_placeholder(&avatar(&state, PLAYER).await);
        assert_placeholder(&avatar(&state, PLAYER).await);
        assert_eq!(
            requests.load(Ordering::SeqCst),
            1,
            "no second fetch within the hour"
        );
    }

    #[sqlx::test]
    async fn a_stored_url_off_steams_cdn_is_never_followed(db: PgPool) {
        // The column only insists on https, so a bad import could hold any host.
        add_player(&db, Some("https://example.com/a.jpg"), Some(1)).await;

        assert_placeholder(&avatar(&AppState::for_tests(db), PLAYER).await);
    }

    #[sqlx::test]
    async fn a_legacy_player_gets_the_old_sites_avatar(db: PgPool) {
        sqlx::query(
            "INSERT INTO legacy_players (steamid64, name, avatar_url) VALUES ($1, 'strafe cat', $2)",
        )
        .bind(SteamId64::parse_any(PLAYER).unwrap().get())
        .bind(AVATAR)
        .execute(&db)
        .await
        .unwrap();

        let response = avatar(&AppState::for_tests(db), PLAYER).await;
        assert_eq!(response.status, 302);
        assert_eq!(response.headers[header::LOCATION], AVATAR);
    }

    #[sqlx::test]
    async fn a_page_of_new_players_fills_in_without_flooding_steam(db: PgPool) {
        // A slow stand-in Steam that remembers the most requests it had at once.
        let (in_flight, peak) = (Arc::<AtomicUsize>::default(), Arc::<AtomicUsize>::default());
        let (now, most) = (in_flight.clone(), peak.clone());
        let app = axum::Router::new().route(
            "/profiles/{id}/",
            axum::routing::get(move || async move {
                most.fetch_max(now.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                now.fetch_sub(1, Ordering::SeqCst);
                PROFILE
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let steam =
            crate::steam::Steam::with_base(&Url::parse(&format!("http://{address}/")).unwrap());
        let state = with_steam(&db, steam);

        let mut pictures = tokio::task::JoinSet::new();
        for account in 1..=12 {
            let player = SteamId64::parse_any(&format!("[U:1:{account}]")).unwrap();
            sqlx::query(
                "INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1, 'nova', now())",
            )
            .bind(player.get())
            .execute(&db)
            .await
            .unwrap();
            let state = state.clone();
            pictures.spawn(async move { avatar(&state, &player.to_string()).await.status });
        }
        while let Some(status) = pictures.join_next().await {
            assert_eq!(
                status.unwrap(),
                302,
                "every picture fills in on the first load"
            );
        }
        let peak = peak.load(Ordering::SeqCst);
        assert!(
            (1..=steam_profile::INLINE_FETCHES).contains(&peak),
            "at most 4 at once: {peak}"
        );
    }

    #[test]
    fn only_steams_cdn_over_https() {
        for allowed in [
            AVATAR,
            "https://avatars.akamai.steamstatic.com/a_full.jpg",
            "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/a.jpg",
        ] {
            assert!(steam_cdn_url(allowed).is_some(), "{allowed}");
        }
        for refused in [
            "http://avatars.steamstatic.com/a.jpg",
            "https://evilsteamstatic.com/a.jpg",
            "https://avatars.steamstatic.com.evil.net/a.jpg",
            "https://x@avatars.steamstatic.com/a.jpg",
            "https://avatars.steamstatic.com:8443/a.jpg",
            "javascript:alert(1)",
            "",
        ] {
            assert!(steam_cdn_url(refused).is_none(), "{refused}");
        }
    }

    #[test]
    fn initials_are_letters_and_digits_only() {
        assert_eq!(initials("strafe cat"), "SC");
        assert_eq!(initials("nova"), "N");
        assert_eq!(initials("[SJ] <b>x</b>"), "SB");
        assert_eq!(initials("<>&\"'"), "?");
        assert_eq!(initials(""), "?");
    }
}
