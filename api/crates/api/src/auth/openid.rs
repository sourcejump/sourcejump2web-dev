//! Steam sign-in over `OpenID` 2.0: building the redirect to Steam, and checking what Steam sends back.
//!
//! Sensitive path, fails closed. The browser carries Steam's answer to us, so anyone can forge one. Nothing in
//! it is trusted until Steam itself confirms it (`check_authentication`), and only fields Steam signed are
//! read. A confirmed answer is accepted once: its nonce is recorded, so replaying it fails. It's also bound
//! to the browser that started it: the callback URL carries a random value that browser holds in a cookie,
//! so someone who starts a sign-in can't send the link Steam gives back to another browser and sign it in
//! as them.

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use url::Url;

use crate::{players::SteamId64, steam::Steam};

const NS: &str = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT: &str = "http://specs.openid.net/auth/2.0/identifier_select";
/// Steam's claimed IDs are this followed by the SteamID64.
const CLAIMED_ID_PREFIX: &str = "https://steamcommunity.com/openid/id/";
/// Fields that must be covered by Steam's signature before we read them.
const MUST_BE_SIGNED: [&str; 6] = [
    "op_endpoint",
    "claimed_id",
    "identity",
    "return_to",
    "response_nonce",
    "assoc_handle",
];
/// Steam answers within seconds; an older assertion is refused, which also bounds the nonce table.
const NONCE_MAX_AGE: Duration = Duration::minutes(5);

pub const CALLBACK_PATH: &str = "/v1/auth/steam/callback";

/// Where to send the player after sign-in: a path on our own site. Anything else falls back to `/`, so
/// sign-in can't be used to bounce people to another site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReturnTo(String);

impl ReturnTo {
    pub fn new(path: Option<&str>) -> Self {
        let safe = path.filter(|path| {
            path.starts_with('/')
                // `//host` and `/\host` are read by browsers as another site.
                && !path.starts_with("//")
                && !path.starts_with("/\\")
                && path.len() <= 512
                && !path.chars().any(char::is_control)
        });
        Self(safe.unwrap_or("/").to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Our callback, with the page to return to and the browser's value riding along. Steam echoes it back as
/// `openid.return_to`.
fn callback_url(public_url: &Url, return_to: &ReturnTo, browser: &str) -> Url {
    let mut url = public_url.join(CALLBACK_PATH).expect("a valid path");
    url.query_pairs_mut()
        .append_pair("return_to", return_to.as_str())
        .append_pair("browser", browser);
    url
}

/// The Steam page that asks the player to sign in. `browser` is the value in the sign-in cookie.
pub fn login_url(steam: &Steam, public_url: &Url, return_to: &ReturnTo, browser: &str) -> Url {
    let mut url = steam.openid_endpoint.clone();
    let realm = public_url.origin().ascii_serialization();
    url.query_pairs_mut()
        .append_pair("openid.ns", NS)
        .append_pair("openid.mode", "checkid_setup")
        .append_pair(
            "openid.return_to",
            callback_url(public_url, return_to, browser).as_str(),
        )
        .append_pair("openid.realm", &realm)
        .append_pair("openid.identity", IDENTIFIER_SELECT)
        .append_pair("openid.claimed_id", IDENTIFIER_SELECT);
    url
}

/// Why a sign-in was refused. Logged for us; the player only sees that it didn't work.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The player turned back on Steam's page. Not an error.
    Cancelled,
    Malformed(&'static str),
    /// The browser bringing the answer back isn't the one that started the sign-in.
    OtherBrowser,
    /// Steam said the assertion isn't one it made, or couldn't be asked.
    NotConfirmed,
    Replayed,
}

/// A sign-in Steam has confirmed.
#[derive(Debug, PartialEq, Eq)]
pub struct Verified {
    pub steamid64: SteamId64,
    pub return_to: ReturnTo,
}

/// Checks Steam's answer, given as the callback's query parameters, and `browser`, the sign-in cookie's
/// value if the browser sent one.
pub async fn verify(
    db: &PgPool,
    steam: &Steam,
    public_url: &Url,
    params: &[(String, String)],
    browser: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Verified, Refusal> {
    let (steamid64, return_to, nonce) = check_fields(steam, public_url, params, browser, now)?;
    confirm_with_steam(steam, params).await?;
    record_nonce(db, &nonce, now).await?;
    Ok(Verified {
        steamid64,
        return_to,
    })
}

fn openid<'a>(params: &'a [(String, String)], field: &str) -> Option<&'a str> {
    params
        .iter()
        .find(|(key, _)| key.strip_prefix("openid.") == Some(field))
        .map(|(_, value)| value.as_str())
}

/// Everything that can be checked without asking Steam. Returns the player, return path and nonce.
fn check_fields(
    steam: &Steam,
    public_url: &Url,
    params: &[(String, String)],
    browser: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(SteamId64, ReturnTo, String), Refusal> {
    let field =
        |name| openid(params, name).ok_or(Refusal::Malformed("a required field is missing"));

    // We read the first copy of a field but pass every copy on to Steam, which may judge by another one. A
    // forged `claimed_id` placed before a genuine assertion's could then pass as confirmed, so a repeated
    // field refuses the whole answer.
    let mut seen = std::collections::HashSet::new();
    if !params
        .iter()
        .filter(|(key, _)| key.starts_with("openid."))
        .all(|(key, _)| seen.insert(key.as_str()))
    {
        return Err(Refusal::Malformed("a field appears more than once"));
    }

    match field("mode")? {
        "id_res" => {}
        "cancel" => return Err(Refusal::Cancelled),
        _ => return Err(Refusal::Malformed("unexpected mode")),
    }
    if field("ns")? != NS {
        return Err(Refusal::Malformed("not OpenID 2.0"));
    }
    if field("op_endpoint")? != steam.openid_endpoint.as_str() {
        return Err(Refusal::Malformed("not from Steam's endpoint"));
    }
    let signed: Vec<&str> = field("signed")?.split(',').collect();
    if !MUST_BE_SIGNED.iter().all(|name| signed.contains(name)) {
        return Err(Refusal::Malformed("a field we rely on isn't signed"));
    }

    let claimed_id = field("claimed_id")?;
    if field("identity")? != claimed_id {
        return Err(Refusal::Malformed("identity and claimed ID differ"));
    }
    let steamid64 = claimed_id
        .strip_prefix(CLAIMED_ID_PREFIX)
        .and_then(|id| SteamId64::try_from(id.to_owned()).ok())
        .ok_or(Refusal::Malformed("not a Steam player ID"))?;

    // The return URL must be our callback exactly; the page to go back to and the browser's value are read
    // from it, since it's signed.
    let signed_return =
        Url::parse(field("return_to")?).map_err(|_| Refusal::Malformed("return_to isn't a URL"))?;
    let signed_query = |name: &str| {
        signed_return
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    let return_to = ReturnTo::new(signed_query("return_to").as_deref());
    let signed_browser = signed_query("browser").unwrap_or_default();
    if signed_return != callback_url(public_url, &return_to, &signed_browser) {
        return Err(Refusal::Malformed("return_to isn't our callback"));
    }
    if signed_browser.is_empty() || browser != Some(signed_browser.as_str()) {
        return Err(Refusal::OtherBrowser);
    }

    let nonce = field("response_nonce")?;
    let issued_at = nonce
        .get(..20)
        .and_then(|stamp| DateTime::parse_from_rfc3339(stamp).ok())
        .ok_or(Refusal::Malformed("unreadable nonce"))?;
    let age = now.signed_duration_since(issued_at);
    // A little allowance for clocks that run ahead of ours.
    if age > NONCE_MAX_AGE || age < -Duration::minutes(1) {
        return Err(Refusal::Malformed("nonce too old"));
    }

    Ok((steamid64, return_to, nonce.to_owned()))
}

/// Sends the assertion back to Steam unchanged except for the mode, as `OpenID` 2.0 specifies.
async fn confirm_with_steam(steam: &Steam, params: &[(String, String)]) -> Result<(), Refusal> {
    let form: Vec<(&str, &str)> = params
        .iter()
        .filter(|(key, _)| key.starts_with("openid."))
        .map(|(key, value)| {
            if key == "openid.mode" {
                (key.as_str(), "check_authentication")
            } else {
                (key.as_str(), value.as_str())
            }
        })
        .collect();
    let response = steam
        .http
        .post(steam.openid_endpoint.clone())
        .form(&form)
        .send()
        .await
        .map_err(|error| {
            tracing::warn!(%error, "couldn't reach Steam to confirm a sign-in");
            Refusal::NotConfirmed
        })?;
    if !response.status().is_success() {
        return Err(Refusal::NotConfirmed);
    }
    let body = response.text().await.map_err(|_| Refusal::NotConfirmed)?;
    // Key-value form: one `key:value` per line.
    if body.lines().any(|line| line.trim() == "is_valid:true") {
        Ok(())
    } else {
        Err(Refusal::NotConfirmed)
    }
}

/// Records the nonce, refusing one already used, and forgets nonces too old to be accepted anyway.
async fn record_nonce(db: &PgPool, nonce: &str, now: DateTime<Utc>) -> Result<(), Refusal> {
    let stored = async {
        sqlx::query!(
            "DELETE FROM openid_nonces WHERE seen_at < $1",
            now - NONCE_MAX_AGE * 2
        )
        .execute(db)
        .await?;
        sqlx::query!(
            "INSERT INTO openid_nonces (nonce, seen_at) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            nonce,
            now
        )
        .execute(db)
        .await
    };
    match stored.await {
        Ok(result) if result.rows_affected() == 1 => Ok(()),
        Ok(_) => Err(Refusal::Replayed),
        Err(error) => {
            tracing::error!(%error, "couldn't record a sign-in nonce");
            Err(Refusal::NotConfirmed)
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub const PLAYER: &str = "76561197960287930";
    /// The sign-in cookie's value in the browser `assertion` belongs to.
    pub const BROWSER: &str = "0123456789abcdef";

    pub fn public_url() -> Url {
        Url::parse("https://sourcejump.test/").unwrap()
    }

    /// The query Steam would send back for `PLAYER`, issued at `issued_at`.
    pub fn assertion(steam: &Steam, issued_at: DateTime<Utc>) -> Vec<(String, String)> {
        let claimed = format!("{CLAIMED_ID_PREFIX}{PLAYER}");
        let nonce = format!("{}abc123", issued_at.format("%Y-%m-%dT%H:%M:%SZ"));
        let return_to = callback_url(
            &public_url(),
            &ReturnTo::new(Some("/maps/bhop_forest")),
            BROWSER,
        );
        [
            ("return_to", "/maps/bhop_forest"),
            ("openid.ns", NS),
            ("openid.mode", "id_res"),
            ("openid.op_endpoint", steam.openid_endpoint.as_str()),
            ("openid.claimed_id", &claimed),
            ("openid.identity", &claimed),
            ("openid.return_to", return_to.as_str()),
            ("openid.response_nonce", &nonce),
            ("openid.assoc_handle", "1234567890"),
            (
                "openid.signed",
                "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
            ),
            ("openid.sig", "c2lnbmF0dXJl"),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect()
    }

    fn with(mut params: Vec<(String, String)>, key: &str, value: &str) -> Vec<(String, String)> {
        params.retain(|(k, _)| k != key);
        params.push((key.to_owned(), value.to_owned()));
        params
    }

    fn check(params: &[(String, String)]) -> Result<(SteamId64, ReturnTo, String), Refusal> {
        check_fields(
            &Steam::new(),
            &public_url(),
            params,
            Some(BROWSER),
            Utc::now(),
        )
    }

    #[test]
    fn return_paths_stay_on_our_site() {
        for path in ["/", "/maps/bhop_forest?style=normal", "/players/1"] {
            assert_eq!(ReturnTo::new(Some(path)).as_str(), path);
        }
        for path in [
            "https://evil.example/",
            "//evil.example/",
            "/\\evil.example/",
            "evil",
            "/\nheader",
        ] {
            assert_eq!(ReturnTo::new(Some(path)).as_str(), "/", "{path:?}");
        }
        assert_eq!(ReturnTo::new(None).as_str(), "/");
    }

    #[test]
    fn the_login_url_goes_to_steam_and_back_to_us() {
        let url = login_url(
            &Steam::new(),
            &public_url(),
            &ReturnTo::new(Some("/maps")),
            BROWSER,
        );
        let query: Vec<(String, String)> = url.query_pairs().into_owned().collect();

        assert!(
            url.as_str()
                .starts_with("https://steamcommunity.com/openid/login?")
        );
        assert_eq!(
            openid(&query, "return_to"),
            Some(
                "https://sourcejump.test/v1/auth/steam/callback?return_to=%2Fmaps&browser=0123456789abcdef"
            )
        );
        assert_eq!(openid(&query, "realm"), Some("https://sourcejump.test"));
    }

    #[test]
    fn accepts_a_well_formed_assertion() {
        let (steamid64, return_to, _) = check(&assertion(&Steam::new(), Utc::now())).unwrap();
        assert_eq!(steamid64.to_string(), PLAYER);
        assert_eq!(return_to.as_str(), "/maps/bhop_forest");
    }

    #[test]
    fn refuses_tampered_assertions() {
        let good = assertion(&Steam::new(), Utc::now());
        let other_player = format!("{CLAIMED_ID_PREFIX}76561197960287931");
        let cases = [
            with(
                good.clone(),
                "openid.op_endpoint",
                "https://evil.example/openid/login",
            ),
            with(good.clone(), "openid.identity", &other_player),
            with(
                with(good.clone(), "openid.identity", "https://evil.example/id/1"),
                "openid.claimed_id",
                "https://evil.example/id/1",
            ),
            with(
                good.clone(),
                "openid.return_to",
                "https://evil.example/v1/auth/steam/callback?return_to=%2F",
            ),
            with(good.clone(), "openid.signed", "signed,claimed_id,identity"),
            with(good.clone(), "openid.ns", "http://openid.net/signon/1.1"),
            with(good.clone(), "openid.response_nonce", "garbage"),
            good.iter()
                .filter(|(key, _)| key != "openid.claimed_id")
                .cloned()
                .collect(),
        ];
        for params in cases {
            assert!(
                matches!(check(&params), Err(Refusal::Malformed(_))),
                "{params:?}"
            );
        }
    }

    #[test]
    fn refuses_an_answer_brought_back_by_another_browser() {
        let good = assertion(&Steam::new(), Utc::now());
        for browser in [None, Some("fedcba9876543210")] {
            assert_eq!(
                check_fields(&Steam::new(), &public_url(), &good, browser, Utc::now()),
                Err(Refusal::OtherBrowser),
                "{browser:?}"
            );
        }
        // An answer to a callback URL without the value is refused even when the browser has none either.
        let unbound = with(
            good,
            "openid.return_to",
            "https://sourcejump.test/v1/auth/steam/callback?return_to=%2Fmaps%2Fbhop_forest",
        );
        assert_eq!(
            check_fields(&Steam::new(), &public_url(), &unbound, None, Utc::now()),
            Err(Refusal::Malformed("return_to isn't our callback"))
        );
    }

    #[test]
    fn refuses_a_repeated_field() {
        let other_player = format!("{CLAIMED_ID_PREFIX}76561197960287931");
        let mut params = vec![
            ("openid.claimed_id".to_owned(), other_player.clone()),
            ("openid.identity".to_owned(), other_player),
        ];
        params.extend(assertion(&Steam::new(), Utc::now()));
        assert_eq!(
            check(&params),
            Err(Refusal::Malformed("a field appears more than once"))
        );
    }

    #[test]
    fn refuses_an_old_assertion() {
        let old = assertion(&Steam::new(), Utc::now() - Duration::minutes(10));
        assert_eq!(check(&old), Err(Refusal::Malformed("nonce too old")));
    }

    #[test]
    fn a_cancelled_sign_in_is_not_an_error() {
        let cancelled = with(
            assertion(&Steam::new(), Utc::now()),
            "openid.mode",
            "cancel",
        );
        assert_eq!(check(&cancelled), Err(Refusal::Cancelled));
    }
}
