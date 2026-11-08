//! Signed-in sessions: creating and ending them, and the `SignedIn` extractor that reads the session cookie.
//!
//! Sensitive path, fails closed. The cookie holds 32 random bytes; only their SHA-256 is stored, as with API
//! keys, so a database leak doesn't hand out sessions. A session ends 30 days after it was last used.

use std::fmt::Write as _;

use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::{HeaderMap, header, request::Parts},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use url::Url;

use crate::{
    app::AppState,
    error::ApiError,
    players::{SteamId64, privileges::Privileges},
};

pub const COOKIE: &str = "sj_session";
const TOKEN_BYTES: usize = 32;

/// Starts a session for the player and returns the token for their cookie.
pub async fn create(db: &PgPool, steamid64: SteamId64) -> Result<String, sqlx::Error> {
    let token = generate();
    // Expired sessions are swept here rather than by a separate job; sign-ins are frequent enough.
    sqlx::query!("DELETE FROM sessions WHERE expires_at < now()")
        .execute(db)
        .await?;
    sqlx::query!(
        "INSERT INTO sessions (hash, player_steamid64, expires_at) VALUES ($1, $2, now() + interval '30 days')",
        &hash(&token)[..],
        steamid64.get()
    )
    .execute(db)
    .await?;
    Ok(token)
}

/// Ends every session of this player, in every browser, such as one left signed in on someone else's computer.
pub async fn end_all(db: &PgPool, steamid64: SteamId64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "DELETE FROM sessions WHERE player_steamid64 = $1",
        steamid64.get()
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn end(db: &PgPool, token: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM sessions WHERE hash = $1", &hash(token)[..])
        .execute(db)
        .await?;
    Ok(())
}

/// The player behind a session token, if the session is live. Pushes its expiry forward, at most once a day
/// so a busy player doesn't cause a write on every page.
async fn look_up(db: &PgPool, token: &str) -> Result<Option<SignedIn>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        WITH extended AS (
            UPDATE sessions SET expires_at = now() + interval '30 days'
            WHERE hash = $1 AND expires_at > now() AND expires_at < now() + interval '29 days'
        )
        SELECT p.steamid64, p.privileges
        FROM sessions s JOIN players p ON p.steamid64 = s.player_steamid64
        WHERE s.hash = $1 AND s.expires_at > now()
        "#,
        &hash(token)[..]
    )
    .fetch_optional(db)
    .await?;
    Ok(row.and_then(|row| {
        Some(SignedIn {
            steamid64: SteamId64::try_from(row.steamid64.to_string()).ok()?,
            privileges: Privileges::from_bits(row.privileges),
        })
    }))
}

/// The cookie that carries a new session. `Secure` holds on localhost too, which browsers treat as secure.
pub fn session_cookie(token: String) -> Cookie<'static> {
    Cookie::build((COOKIE, token))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        // The session's own expiry, kept in the database, is what counts; the cookie just has to outlive it.
        .permanent()
        .build()
}

pub fn removal_cookie() -> Cookie<'static> {
    Cookie::build((COOKIE, "")).path("/").build()
}

/// A request from a signed-in player. Taking it as a handler argument answers 401 to everyone else; taking
/// `Option<SignedIn>` lets the handler serve both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignedIn {
    pub steamid64: SteamId64,
    pub privileges: Privileges,
}

impl OptionalFromRequestParts<AppState> for SignedIn {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Option<Self>, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        match jar.get(COOKIE) {
            Some(cookie) if !cookie.value().is_empty() => {
                Ok(look_up(&state.db, cookie.value()).await?)
            }
            _ => Ok(None),
        }
    }
}

impl FromRequestParts<AppState> for SignedIn {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        <Self as OptionalFromRequestParts<AppState>>::from_request_parts(parts, state)
            .await?
            .ok_or(ApiError::SignInRequired)
    }
}

/// Requests that change something on a session cookie must come from our own pages. `SameSite=Lax` already
/// keeps the cookie off other sites' POSTs; this check doesn't rely on that alone. No `Origin`, no change.
pub fn require_same_origin(headers: &HeaderMap, public_url: &Url) -> Result<(), ApiError> {
    let ours = public_url.origin().ascii_serialization();
    match headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        Some(origin) if origin == ours => Ok(()),
        _ => Err(ApiError::Forbidden(
            "this request must come from SourceJump's own pages",
        )),
    }
}

/// A random token, as hex.
pub(super) fn generate() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).expect("the operating system's random source failed");
    bytes
        .iter()
        .fold(String::with_capacity(TOKEN_BYTES * 2), |mut token, byte| {
            write!(token, "{byte:02x}").expect("writing to a String can't fail");
            token
        })
}

fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player() -> SteamId64 {
        SteamId64::try_from("76561197960287930".to_owned()).unwrap()
    }

    async fn add_player(db: &PgPool) {
        crate::players::record_name(
            &mut db.acquire().await.unwrap(),
            player(),
            "nova",
            chrono::Utc::now(),
        )
        .await
        .unwrap();
    }

    #[sqlx::test]
    async fn a_session_finds_its_player_until_it_ends(db: PgPool) {
        add_player(&db).await;
        let token = create(&db, player()).await.unwrap();

        let signed_in = look_up(&db, &token).await.unwrap().unwrap();
        assert_eq!(signed_in.steamid64, player());
        assert_eq!(signed_in.privileges, Privileges::default());

        end(&db, &token).await.unwrap();
        assert_eq!(look_up(&db, &token).await.unwrap(), None);
    }

    #[sqlx::test]
    async fn an_expired_session_finds_nobody(db: PgPool) {
        add_player(&db).await;
        let token = create(&db, player()).await.unwrap();
        sqlx::query!("UPDATE sessions SET expires_at = now() - interval '1 second'")
            .execute(&db)
            .await
            .unwrap();

        assert_eq!(look_up(&db, &token).await.unwrap(), None);
    }

    #[sqlx::test]
    async fn using_a_session_extends_it(db: PgPool) {
        add_player(&db).await;
        let token = create(&db, player()).await.unwrap();
        sqlx::query!("UPDATE sessions SET expires_at = now() + interval '2 days'")
            .execute(&db)
            .await
            .unwrap();

        look_up(&db, &token).await.unwrap().unwrap();
        let days_left = sqlx::query_scalar!(
            r#"SELECT extract(day FROM expires_at - now())::int AS "days!" FROM sessions"#
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(days_left, 29);
    }

    #[test]
    fn only_our_origin_may_change_things() {
        let ours = Url::parse("https://sourcejump.test/").unwrap();
        let with_origin = |origin: Option<&str>| {
            let mut headers = HeaderMap::new();
            if let Some(origin) = origin {
                headers.insert(header::ORIGIN, origin.parse().unwrap());
            }
            require_same_origin(&headers, &ours).is_ok()
        };

        assert!(with_origin(Some("https://sourcejump.test")));
        assert!(!with_origin(Some("https://evil.example")));
        assert!(!with_origin(Some("http://sourcejump.test")));
        assert!(!with_origin(Some("null")));
        assert!(!with_origin(None));
    }

    #[test]
    fn tokens_are_random() {
        let (a, b) = (generate(), generate());
        assert_ne!(a, b);
        assert_eq!(a.len(), TOKEN_BYTES * 2);
    }
}
