//! Signing in with Steam and out again, and `GET /v1/me` for the signed-in player.
//!
//! These endpoints are for browsers: they answer with redirects and cookies, not JSON. The website links to
//! `/v1/auth/steam`, which sets the sign-in cookie that binds the sign-in to this browser; Steam sends the
//! player back to the callback, and the callback sets the session cookie.

pub mod openid;
pub mod sessions;

use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
    response::Redirect,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::{self, privileges::Privilege},
};
use openid::{Refusal, ReturnTo};
use sessions::SignedIn;

/// The website's page for a sign-in that didn't complete.
const FAILED_PAGE: &str = "/sign-in/failed";

/// Holds the value the callback URL must carry, from the start of a sign-in to its callback. It lasts until
/// the browser closes, or the callback uses it up; it needs no shorter life, since only a Steam answer at
/// most five minutes old is accepted with it.
const SIGN_IN_COOKIE: &str = "sj_sign_in";

/// Sent only to the callback. Lax, not Strict: Steam's redirect back is a cross-site navigation.
fn sign_in_cookie(value: String) -> Cookie<'static> {
    Cookie::build((SIGN_IN_COOKIE, value))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path(openid::CALLBACK_PATH)
        .build()
}

fn sign_in_removal_cookie() -> Cookie<'static> {
    Cookie::build((SIGN_IN_COOKIE, ""))
        .path(openid::CALLBACK_PATH)
        .build()
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ReturnQuery {
    /// The page to come back to: a path on this site, such as `/maps`. Anything else means `/`.
    return_to: Option<String>,
}

/// The signed-in player.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Me {
    /// SteamID64, as a string.
    pub steamid64: String,
    pub name: String,
    pub avatar_url: Option<String>,
    /// ISO 3166-1 alpha-2, from the player's Steam profile.
    pub country_code: Option<String>,
    /// Staff privileges. Empty for most players.
    pub privileges: Vec<Privilege>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(start))
        .routes(routes!(callback))
        .routes(routes!(sign_out))
        .routes(routes!(sign_out_everywhere))
        .routes(routes!(me))
}

/// Sends the browser to Steam to sign in.
#[utoipa::path(
    get,
    path = "/v1/auth/steam",
    tag = "auth",
    params(ReturnQuery),
    responses((status = SEE_OTHER, description = "To Steam's sign-in page")),
)]
async fn start(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<ReturnQuery>,
) -> (CookieJar, Redirect) {
    let return_to = ReturnTo::new(query.return_to.as_deref());
    // A sign-in started in another tab since replaces this value, so only the latest one completes.
    let browser = sessions::generate();
    let login_url = openid::login_url(&state.steam, &state.public_url, &return_to, &browser);
    (
        jar.add(sign_in_cookie(browser)),
        Redirect::to(login_url.as_str()),
    )
}

/// Where Steam sends the browser back. Starts a session if Steam confirms the sign-in.
#[utoipa::path(
    get,
    path = "/v1/auth/steam/callback",
    tag = "auth",
    responses((
        status = SEE_OTHER,
        description = "Back to the page the player came from, signed in; or to the website's sign-in failure page",
    )),
)]
async fn callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<(CookieJar, Redirect), ApiError> {
    let browser = jar
        .get(SIGN_IN_COOKIE)
        .map(|cookie| cookie.value().to_owned());
    // Used up either way: a sign-in that failed starts again from the beginning.
    let jar = jar.remove(sign_in_removal_cookie());
    let verified = match openid::verify(
        &state.db,
        &state.steam,
        &state.public_url,
        &params,
        browser.as_deref(),
        Utc::now(),
    )
    .await
    {
        Ok(verified) => verified,
        Err(Refusal::Cancelled) => {
            let requested = params
                .iter()
                .find(|(key, _)| key == "return_to")
                .map(|(_, value)| value.as_str());
            return Ok((jar, Redirect::to(ReturnTo::new(requested).as_str())));
        }
        Err(refusal) => {
            tracing::warn!(?refusal, "refused a Steam sign-in");
            return Ok((jar, Redirect::to(FAILED_PAGE)));
        }
    };

    players::ensure_exists(&state.db, verified.steamid64).await?;
    // Always fresh at sign-in, so a player who just changed their avatar or country sees it.
    players::steam_profile::refresh_if_stale(
        state.db.clone(),
        state.steam.clone(),
        verified.steamid64,
        None,
    );
    let token = sessions::create(&state.db, verified.steamid64).await?;
    tracing::info!(steamid64 = %verified.steamid64, "signed in");
    Ok((
        jar.add(sessions::session_cookie(token)),
        Redirect::to(verified.return_to.as_str()),
    ))
}

/// Ends the session. A form on the website posts here.
#[utoipa::path(
    post,
    path = "/v1/auth/sign-out",
    tag = "auth",
    params(ReturnQuery),
    responses(
        (status = SEE_OTHER, description = "Back to the page the player came from, signed out"),
        (status = FORBIDDEN, description = "Not sent from SourceJump's own pages", body = ErrorBody),
    ),
)]
async fn sign_out(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Query(query): Query<ReturnQuery>,
) -> Result<(CookieJar, Redirect), ApiError> {
    sessions::require_same_origin(&headers, &state.public_url)?;
    if let Some(cookie) = jar.get(sessions::COOKIE) {
        sessions::end(&state.db, cookie.value()).await?;
    }
    let return_to = ReturnTo::new(query.return_to.as_deref());
    Ok((
        jar.remove(sessions::removal_cookie()),
        Redirect::to(return_to.as_str()),
    ))
}

/// Ends every session of the signed-in player, in every browser, and signs this one out. A form on the
/// website posts here. Without a live session it only clears this browser's cookie, as signing out does.
#[utoipa::path(
    post,
    path = "/v1/auth/sign-out-everywhere",
    tag = "auth",
    params(ReturnQuery),
    responses(
        (status = SEE_OTHER, description = "Back to the page the player came from, signed out everywhere"),
        (status = FORBIDDEN, description = "Not sent from SourceJump's own pages", body = ErrorBody),
    ),
)]
async fn sign_out_everywhere(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    signed_in: Option<SignedIn>,
    Query(query): Query<ReturnQuery>,
) -> Result<(CookieJar, Redirect), ApiError> {
    sessions::require_same_origin(&headers, &state.public_url)?;
    if let Some(signed_in) = signed_in {
        sessions::end_all(&state.db, signed_in.steamid64).await?;
        tracing::info!(steamid64 = %signed_in.steamid64, "signed out everywhere");
    }
    let return_to = ReturnTo::new(query.return_to.as_deref());
    Ok((
        jar.remove(sessions::removal_cookie()),
        Redirect::to(return_to.as_str()),
    ))
}

/// The signed-in player, from the session cookie, or `null` for a visitor who isn't signed in.
///
/// Not a `401`: public pages ask on every visit, and a failed request shows as an error in the visitor's
/// console.
#[utoipa::path(
    get,
    path = "/v1/me",
    tag = "auth",
    responses((status = OK, description = "The player, or `null` when not signed in", body = Option<Me>)),
)]
async fn me(
    State(state): State<AppState>,
    signed_in: Option<SignedIn>,
) -> Result<Json<Option<Me>>, ApiError> {
    let Some(signed_in) = signed_in else {
        return Ok(Json(None));
    };
    let player = sqlx::query!(
        "SELECT name, avatar_url, country_code FROM players WHERE steamid64 = $1",
        signed_in.steamid64.get()
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(Some(Me {
        steamid64: signed_in.steamid64.to_string(),
        name: player.name,
        avatar_url: player.avatar_url,
        country_code: player.country_code,
        privileges: signed_in.privileges.list(),
    })))
}

#[cfg(test)]
mod tests {
    use axum::{
        Form, Router,
        body::Body,
        http::{Request, header},
        routing::post,
    };
    use sqlx::PgPool;
    use url::Url;

    use super::*;
    use crate::{
        steam::Steam,
        test_client::{self, TestResponse},
    };

    /// A stand-in for Steam's `OpenID` endpoint that answers every check with `is_valid`.
    async fn fake_steam(is_valid: bool) -> Steam {
        let app = Router::new().route(
            "/openid/login",
            post(move |Form(form): Form<Vec<(String, String)>>| async move {
                let mode = form.iter().find(|(key, _)| key == "openid.mode");
                assert_eq!(mode.map(|(_, v)| v.as_str()), Some("check_authentication"));
                format!("ns:http://specs.openid.net/auth/2.0\nis_valid:{is_valid}\n")
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Steam::with_base(&Url::parse(&format!("http://{address}/")).unwrap())
    }

    fn state(db: &PgPool, steam: Steam) -> AppState {
        AppState {
            steam,
            public_url: openid::tests::public_url(),
            ..AppState::for_tests(db.clone())
        }
    }

    /// Steam's answer to the callback, from a browser whose sign-in cookie holds `browser`.
    fn callback(state: &AppState, browser: Option<&str>) -> Request<Body> {
        let params = openid::tests::assertion(&state.steam, Utc::now());
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(&params)
            .finish();
        let request = Request::get(format!("/v1/auth/steam/callback?{query}"));
        match browser {
            Some(value) => request.header(header::COOKIE, format!("sj_sign_in={value}")),
            None => request,
        }
        .body(Body::empty())
        .unwrap()
    }

    async fn sign_in(state: &AppState) -> TestResponse {
        let request = callback(state, Some(openid::tests::BROWSER));
        test_client::send_to(state.clone(), request).await
    }

    /// The `Set-Cookie` header for `name`, if the response has one.
    fn set_cookie<'a>(response: &'a TestResponse, name: &str) -> Option<&'a str> {
        response
            .headers
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|value| value.to_str().unwrap())
            .find(|value| value.starts_with(&format!("{name}=")))
    }

    fn session_from(response: &TestResponse) -> String {
        let set_cookie = set_cookie(response, "sj_session").expect("a session cookie");
        assert!(set_cookie.contains("HttpOnly") && set_cookie.contains("Secure"));
        assert!(set_cookie.contains("SameSite=Lax"));
        set_cookie
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("sj_session=")
            .unwrap()
            .to_owned()
    }

    async fn me_with(state: &AppState, token: &str) -> TestResponse {
        let request = Request::get("/v1/me")
            .header(header::COOKIE, format!("sj_session={token}"))
            .body(Body::empty())
            .unwrap();
        test_client::send_to(state.clone(), request).await
    }

    /// Whether `GET /v1/me` names a player for this session token.
    async fn signed_in(state: &AppState, token: &str) -> bool {
        let response = me_with(state, token).await;
        assert_eq!(response.status, 200);
        !response.json::<serde_json::Value>().is_null()
    }

    #[sqlx::test]
    async fn signing_in_starts_a_session(db: PgPool) {
        let state = state(&db, fake_steam(true).await);

        let response = sign_in(&state).await;
        assert_eq!(response.status, 303);
        assert_eq!(response.headers[header::LOCATION], "/maps/bhop_forest");

        let used_up = set_cookie(&response, "sj_sign_in").expect("the sign-in cookie is removed");
        assert!(used_up.starts_with("sj_sign_in=;"), "{used_up}");

        let me = me_with(&state, &session_from(&response)).await;
        assert_eq!(me.status, 200);
        let me: Me = me.json();
        assert_eq!(me.steamid64, openid::tests::PLAYER);
        assert_eq!(me.privileges, []);
    }

    #[sqlx::test]
    async fn a_replayed_sign_in_is_refused(db: PgPool) {
        let state = state(&db, fake_steam(true).await);
        let params = openid::tests::assertion(&state.steam, Utc::now());
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(&params)
            .finish();
        let send = || {
            test_client::send_to(
                state.clone(),
                Request::get(format!("/v1/auth/steam/callback?{query}"))
                    .header(
                        header::COOKIE,
                        format!("sj_sign_in={}", openid::tests::BROWSER),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
        };

        assert_eq!(send().await.headers[header::LOCATION], "/maps/bhop_forest");
        let replay = send().await;
        assert_eq!(replay.headers[header::LOCATION], FAILED_PAGE);
        assert!(set_cookie(&replay, "sj_session").is_none());
    }

    #[sqlx::test]
    async fn a_sign_in_brought_back_by_another_browser_is_refused(db: PgPool) {
        // Someone starts a sign-in to their own account and sends the link Steam gives back to someone else.
        let state = state(&db, fake_steam(true).await);
        for browser in [None, Some("fedcba9876543210")] {
            let response = test_client::send_to(state.clone(), callback(&state, browser)).await;
            assert_eq!(response.headers[header::LOCATION], FAILED_PAGE);
            assert!(set_cookie(&response, "sj_session").is_none(), "{browser:?}");
        }
    }

    #[sqlx::test]
    async fn a_sign_in_steam_doesnt_confirm_is_refused(db: PgPool) {
        let state = state(&db, fake_steam(false).await);

        let response = sign_in(&state).await;
        assert_eq!(response.headers[header::LOCATION], FAILED_PAGE);
        assert!(set_cookie(&response, "sj_session").is_none());
    }

    #[sqlx::test]
    async fn me_is_null_without_a_live_session(db: PgPool) {
        let state = state(&db, Steam::new());
        assert!(!signed_in(&state, "not-a-session").await);
        let anonymous =
            test_client::send_to(state, Request::get("/v1/me").body(Body::empty()).unwrap()).await;
        assert_eq!(anonymous.status, 200);
        assert!(anonymous.json::<serde_json::Value>().is_null());
    }

    #[sqlx::test]
    async fn signing_out_ends_the_session_only_from_our_pages(db: PgPool) {
        let state = state(&db, fake_steam(true).await);
        let token = session_from(&sign_in(&state).await);
        let sign_out = |origin: &'static str| {
            test_client::send_to(
                state.clone(),
                Request::post("/v1/auth/sign-out?return_to=/maps")
                    .header(header::COOKIE, format!("sj_session={token}"))
                    .header(header::ORIGIN, origin)
                    .body(Body::empty())
                    .unwrap(),
            )
        };

        assert_eq!(sign_out("https://evil.example").await.status, 403);
        assert!(signed_in(&state, &token).await);

        let response = sign_out("https://sourcejump.test").await;
        assert_eq!(response.status, 303);
        assert_eq!(response.headers[header::LOCATION], "/maps");
        assert!(!signed_in(&state, &token).await);
    }

    #[sqlx::test]
    async fn signing_out_everywhere_ends_every_session_of_the_player_only(db: PgPool) {
        let state = state(&db, fake_steam(true).await);
        let token = session_from(&sign_in(&state).await);
        let player = players::SteamId64::try_from(openid::tests::PLAYER.to_owned()).unwrap();
        // The same player signed in on another computer, and someone else signed in.
        let elsewhere = sessions::create(&db, player).await.unwrap();
        let other = players::SteamId64::try_from("76561197960287931".to_owned()).unwrap();
        players::ensure_exists(&db, other).await.unwrap();
        let someone_else = sessions::create(&db, other).await.unwrap();
        let sign_out_everywhere = |origin: &'static str| {
            test_client::send_to(
                state.clone(),
                Request::post("/v1/auth/sign-out-everywhere?return_to=/maps")
                    .header(header::COOKIE, format!("sj_session={token}"))
                    .header(header::ORIGIN, origin)
                    .body(Body::empty())
                    .unwrap(),
            )
        };

        assert_eq!(
            sign_out_everywhere("https://evil.example").await.status,
            403
        );
        assert!(signed_in(&state, &elsewhere).await);

        let response = sign_out_everywhere("https://sourcejump.test").await;
        assert_eq!(response.status, 303);
        assert_eq!(response.headers[header::LOCATION], "/maps");
        let removed = set_cookie(&response, "sj_session").expect("the session cookie is removed");
        assert!(removed.starts_with("sj_session=;"), "{removed}");
        assert!(!signed_in(&state, &token).await);
        assert!(!signed_in(&state, &elsewhere).await);
        assert!(signed_in(&state, &someone_else).await);

        // Again without a live session: nothing to end, and the same way back.
        let again = sign_out_everywhere("https://sourcejump.test").await;
        assert_eq!(again.status, 303);
        assert_eq!(again.headers[header::LOCATION], "/maps");
    }

    #[sqlx::test]
    async fn start_sends_the_browser_to_steam(db: PgPool) {
        let response = test_client::get(&db, "/v1/auth/steam?return_to=//evil.example").await;
        assert_eq!(response.status, 303);
        let location = response.headers[header::LOCATION].to_str().unwrap();
        assert!(
            location.starts_with("http://127.0.0.1:9/openid/login?"),
            "{location}"
        );
        let browser = set_cookie(&response, "sj_sign_in").expect("a sign-in cookie");
        assert!(
            browser.contains("HttpOnly")
                && browser.contains("Secure")
                && browser.contains("SameSite=Lax")
                && browser.contains("Path=/v1/auth/steam/callback"),
            "{browser}"
        );
        let value = browser
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("sj_sign_in=")
            .unwrap();
        assert_eq!(value.len(), 64);
        assert!(
            location.contains(&format!(
                "callback%3Freturn_to%3D%252F%26browser%3D{value}&"
            )),
            "{location}"
        );
    }
}
