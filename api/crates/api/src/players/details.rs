//! What players say about themselves on their profile, `PUT /v1/players/{player}/details`: their setup (mouse,
//! DPI, sensitivity, mouse pad, keyboard, monitor, aspect ratio) and a country to show (order: `docs/site-api.md`).
//!
//! Anyone can type anything here, so every field is checked once, at this boundary: short single lines of
//! text with no links or invisible characters, numbers in a sensible range, a ratio from a fixed list and a
//! country SourceJump knows. A player saves at most once every few seconds, and staff can ban them from
//! saving (`no_profile_edits`). Staff with `manage_bans` can change anyone's details, with a reason that goes
//! in the staff log. Until a player saves their own, the profile shows what they had on the old site.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgConnection;
use utoipa::ToSchema;

use super::{
    SteamId64, countries,
    privileges::Privilege,
    restrictions::{self, Restriction},
};
use crate::{
    app::AppState,
    auth::sessions::{SignedIn, require_same_origin},
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    staff::log::{self, StaffAction, check_reason},
};

/// Room for "Logitech G Pro X Superlight 2" and the like, and not for a paragraph.
const MAX_TEXT_CHARS: usize = 48;
/// The shortest time between a player's saves.
const SAVE_PAUSE_SECONDS: f64 = 5.0;

/// A monitor's aspect ratio, from the ones people play on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum Aspect {
    #[serde(rename = "4:3")]
    FourByThree,
    #[serde(rename = "5:4")]
    FiveByFour,
    #[serde(rename = "16:10")]
    SixteenByTen,
    #[serde(rename = "16:9")]
    SixteenByNine,
    #[serde(rename = "21:9")]
    TwentyOneByNine,
    #[serde(rename = "32:9")]
    ThirtyTwoByNine,
}

impl Aspect {
    const ALL: [Self; 6] = [
        Self::FourByThree,
        Self::FiveByFour,
        Self::SixteenByTen,
        Self::SixteenByNine,
        Self::TwentyOneByNine,
        Self::ThirtyTwoByNine,
    ];

    /// As stored and shown: "16:9".
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FourByThree => "4:3",
            Self::FiveByFour => "5:4",
            Self::SixteenByTen => "16:10",
            Self::SixteenByNine => "16:9",
            Self::TwentyOneByNine => "21:9",
            Self::ThirtyTwoByNine => "32:9",
        }
    }

    fn from_stored(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|aspect| aspect.as_str() == text)
    }

    /// The ratio in what someone typed on the old site: "16:9", "16x9", "Widescreen 16:9". Longer ratios are
    /// tried first, so a short one can't match inside a longer one.
    fn in_old_text(text: &str) -> Option<Self> {
        let text = text.replace(['x', 'X', '/'], ":").replace(' ', "");
        let mut longest_first = Self::ALL;
        longest_first.sort_by_key(|aspect| std::cmp::Reverse(aspect.as_str().len()));
        longest_first
            .into_iter()
            .find(|aspect| text.contains(aspect.as_str()))
    }
}

/// A player's details. Every field is optional; null means they didn't say.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlayerDetails {
    pub mouse: Option<String>,
    pub dpi: Option<i32>,
    /// In-game sensitivity.
    pub sensitivity: Option<f64>,
    pub mouse_pad: Option<String>,
    pub keyboard: Option<String>,
    pub monitor: Option<String>,
    pub aspect: Option<Aspect>,
}

impl PlayerDetails {
    fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// The fields that differ from `other`, by name, for the staff log.
    fn changed_from(&self, other: &Self) -> Vec<&'static str> {
        [
            ("mouse", self.mouse != other.mouse),
            ("dpi", self.dpi != other.dpi),
            ("sensitivity", self.sensitivity != other.sensitivity),
            ("mouse_pad", self.mouse_pad != other.mouse_pad),
            ("keyboard", self.keyboard != other.keyboard),
            ("monitor", self.monitor != other.monitor),
            ("aspect", self.aspect != other.aspect),
        ]
        .into_iter()
        .filter_map(|(field, differs)| differs.then_some(field))
        .collect()
    }
}

/// What the profile shows: the player's saved details, or else what they had on the old site.
pub struct Shown {
    pub details: Option<PlayerDetails>,
    pub from_old_site: bool,
}

/// The details a profile shows for the player. None when they have none, saved or old.
pub async fn shown(conn: &mut PgConnection, player: SteamId64) -> Result<Shown, sqlx::Error> {
    if let Some(saved) = saved(conn, player).await? {
        return Ok(Shown {
            details: (!saved.is_empty()).then_some(saved),
            from_old_site: false,
        });
    }
    let old = sqlx::query!(
        "SELECT setup_mouse, setup_dpi, setup_sens, setup_mouse_pad, setup_keyboard, setup_monitor, setup_aspect
         FROM legacy_players WHERE steamid64 = $1",
        player.get()
    )
    .fetch_optional(conn)
    .await?;
    // The old site checked nothing, so its values go through the same checks as new ones, and any that fail
    // are left out rather than shown as typed.
    let details = old.map(|old| {
        let text =
            |value: Option<String>| value.and_then(|value| clean_text(&value).ok().flatten());
        PlayerDetails {
            mouse: text(old.setup_mouse),
            dpi: old
                .setup_dpi
                .and_then(|dpi| dpi.trim().parse().ok())
                .and_then(|dpi| check_dpi(Some(dpi)).ok().flatten()),
            sensitivity: old
                .setup_sens
                .and_then(|sens| sens.trim().replace(',', ".").parse().ok())
                .and_then(|sens| check_sensitivity(Some(sens)).ok().flatten()),
            mouse_pad: text(old.setup_mouse_pad),
            keyboard: text(old.setup_keyboard),
            monitor: text(old.setup_monitor),
            aspect: old.setup_aspect.as_deref().and_then(Aspect::in_old_text),
        }
    });
    Ok(Shown {
        from_old_site: details.as_ref().is_some_and(|d| !d.is_empty()),
        details: details.filter(|d| !d.is_empty()),
    })
}

/// The details the player (or staff) saved, if ever.
async fn saved(
    conn: &mut PgConnection,
    player: SteamId64,
) -> Result<Option<PlayerDetails>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT mouse, dpi, sensitivity, mouse_pad, keyboard, monitor, aspect FROM player_details
         WHERE player_steamid64 = $1",
        player.get()
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| PlayerDetails {
        mouse: row.mouse,
        dpi: row.dpi,
        sensitivity: row.sensitivity,
        mouse_pad: row.mouse_pad,
        keyboard: row.keyboard,
        monitor: row.monitor,
        aspect: row.aspect.as_deref().and_then(Aspect::from_stored),
    }))
}

/// New details for a profile. Every field is replaced: leave one out or null to clear it.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DetailsInput {
    /// Up to 48 characters, one line, no links. Likewise `mouse_pad`, `keyboard` and `monitor`.
    #[serde(default)]
    pub mouse: Option<String>,
    /// 50 to 64000.
    #[serde(default)]
    pub dpi: Option<i32>,
    /// Above 0, up to 100; kept to 4 decimals.
    #[serde(default)]
    pub sensitivity: Option<f64>,
    #[serde(default)]
    pub mouse_pad: Option<String>,
    #[serde(default)]
    pub keyboard: Option<String>,
    #[serde(default)]
    pub monitor: Option<String>,
    #[serde(default)]
    pub aspect: Option<Aspect>,
    /// An ISO 3166-1 alpha-2 code to show instead of Steam's or a game server's, until a run's server finds one;
    /// null to stop showing the player's pick.
    #[serde(default)]
    pub country_code: Option<String>,
    /// Required when staff change someone else's details: why, for the staff log.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Change a profile's details: your own, or as staff with `manage_bans`, anyone's.
#[utoipa::path(
    put,
    path = "/v1/players/{player}/details",
    tag = "players",
    params(("player" = String, Path, description = "SteamID64, SteamID2 or SteamID3")),
    request_body = DetailsInput,
    responses(
        (status = NO_CONTENT, description = "Saved"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Banned from editing, someone else's details without `manage_bans`, or not from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "SourceJump has no such player", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "A field breaks a rule, or a staff edit has no reason", body = ErrorBody),
        (status = TOO_MANY_REQUESTS, description = "Saved a moment ago", body = ErrorBody),
    ),
)]
pub async fn update_player_details(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    Path(player): Path<String>,
    JsonBody(input): JsonBody<DetailsInput>,
) -> Result<StatusCode, ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    let player = SteamId64::parse_any(&player)
        .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID")))?;
    let (details, country) = check(&input)?;
    let own = player == me.steamid64;
    // Staff edits are checked before anything is read, so nobody learns more from a refusal.
    let reason = if own {
        None
    } else if me.privileges.contains(Privilege::ManageBans) {
        Some(check_reason(input.reason.as_deref().unwrap_or_default())?)
    } else {
        return Err(ApiError::Forbidden("you can only change your own details"));
    };

    let mut tx = state.db.begin().await?;
    // Locks the player's row, so two saves at once take turns and the pause between them holds.
    let current = sqlx::query!(
        r#"SELECT p.country_chosen, p.country_code,
                  (SELECT d.updated_at > now() - make_interval(secs => $2) FROM player_details d
                   WHERE d.player_steamid64 = p.steamid64) AS "too_soon?"
           FROM players p WHERE p.steamid64 = $1 FOR UPDATE"#,
        player.get(),
        SAVE_PAUSE_SECONDS
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound("SourceJump has no such player"))?;

    if let Some(reason) = &reason {
        let before = saved(&mut tx, player).await?.unwrap_or_default();
        let mut changed = details.changed_from(&before);
        let country_changes = match (&country, current.country_chosen) {
            (Some(code), true) => current.country_code.as_deref() != Some(code),
            (None, chosen) => chosen,
            (Some(_), false) => true,
        };
        if country_changes {
            changed.push("country");
        }
        if changed.is_empty() {
            return Ok(StatusCode::NO_CONTENT);
        }
        let entry = log::Entry {
            actor: Some(me.steamid64),
            action: StaffAction::EditPlayerDetails,
            target: &player.to_string(),
            reason: Some(reason),
            detail: json!({ "changed": changed, "before": before }),
        };
        log::record(&mut tx, entry).await?;
    } else {
        if restrictions::active(&mut tx, player)
            .await?
            .contains(Restriction::NoProfileEdits)
        {
            return Err(ApiError::Forbidden(
                "you're banned from changing your profile details",
            ));
        }
        if current.too_soon == Some(true) {
            return Err(ApiError::TooManyRequests(
                "you saved a moment ago; wait a few seconds and try again",
            ));
        }
    }

    store(&mut tx, player, &details, country).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Writes checked details and the country choice.
async fn store(
    tx: &mut PgConnection,
    player: SteamId64,
    details: &PlayerDetails,
    country: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO player_details
            (player_steamid64, mouse, dpi, sensitivity, mouse_pad, keyboard, monitor, aspect)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (player_steamid64) DO UPDATE SET
            mouse = excluded.mouse, dpi = excluded.dpi, sensitivity = excluded.sensitivity,
            mouse_pad = excluded.mouse_pad, keyboard = excluded.keyboard, monitor = excluded.monitor,
            aspect = excluded.aspect, updated_at = now()
        "#,
        player.get(),
        details.mouse,
        details.dpi,
        details.sensitivity,
        details.mouse_pad,
        details.keyboard,
        details.monitor,
        details.aspect.map(Aspect::as_str)
    )
    .execute(&mut *tx)
    .await?;
    // A pick replaces a game server's country. Dropping a pick clears it and marks the Steam profile stale, so
    // the next view of the profile fetches Steam's again; dropping a pick the player doesn't have changes nothing.
    sqlx::query!(
        r#"
        UPDATE players SET
            country_chosen = $2::text IS NOT NULL,
            country_from_server = country_from_server AND $2::text IS NULL,
            country_code = CASE WHEN $2::text IS NOT NULL THEN $2
                                WHEN country_chosen THEN NULL ELSE country_code END,
            steam_profile_fetched_at = CASE WHEN $2::text IS NULL AND country_chosen THEN NULL
                                            ELSE steam_profile_fetched_at END
        WHERE steamid64 = $1
        "#,
        player.get(),
        country
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// The input's details, checked, and its country as a known code.
fn check(input: &DetailsInput) -> Result<(PlayerDetails, Option<&'static str>), ApiError> {
    let text = |label: &str, value: &Option<String>| {
        value
            .as_deref()
            .map(clean_text)
            .transpose()
            .map(Option::flatten)
            .map_err(|problem| ApiError::Invalid(format!("{label}: {problem}")))
    };
    let details = PlayerDetails {
        mouse: text("mouse", &input.mouse)?,
        dpi: check_dpi(input.dpi)?,
        sensitivity: check_sensitivity(input.sensitivity)?,
        mouse_pad: text("mouse pad", &input.mouse_pad)?,
        keyboard: text("keyboard", &input.keyboard)?,
        monitor: text("monitor", &input.monitor)?,
        aspect: input.aspect,
    };
    let country = match input.country_code.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(code) => Some(countries::known_code(code).ok_or_else(|| {
            ApiError::Invalid(format!("{code:?} isn't a country code SourceJump knows"))
        })?),
    };
    Ok((details, country))
}

/// One line of text, its spaces tidied, or None when there's nothing left. Refuses links, and characters a
/// reader can't see but that change what they read: control characters, zero-width ones, and direction
/// overrides, which can make text display in a different order than it was typed.
fn clean_text(value: &str) -> Result<Option<String>, &'static str> {
    if value.chars().any(|c| {
        c.is_control()
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}')
    }) {
        return Err("use plain text on one line");
    }
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("at most 48 characters");
    }
    let lower = text.to_lowercase();
    if lower.contains("://") || lower.contains("www.") {
        return Err("links aren't allowed");
    }
    Ok(Some(text))
}

fn check_dpi(dpi: Option<i32>) -> Result<Option<i32>, ApiError> {
    match dpi {
        Some(dpi) if !(50..=64_000).contains(&dpi) => {
            Err(ApiError::Invalid("DPI is 50 to 64000".into()))
        }
        _ => Ok(dpi),
    }
}

fn check_sensitivity(sensitivity: Option<f64>) -> Result<Option<f64>, ApiError> {
    let Some(sensitivity) = sensitivity else {
        return Ok(None);
    };
    let rounded = (sensitivity * 10_000.0).round() / 10_000.0;
    if !rounded.is_finite() || rounded <= 0.0 || rounded > 100.0 {
        return Err(ApiError::Invalid(
            "sensitivity is above 0 and up to 100".into(),
        ));
    }
    Ok(Some(rounded))
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::{Aspect, clean_text};
    use crate::{
        auth::sessions,
        players::{
            SteamId64,
            privileges::{self, Privilege, Privileges},
        },
        test_client::{self, TestResponse},
    };

    const GABE: &str = "76561197960287930";
    const NOVA: &str = "76561197960287931";

    /// A signed-in player holding `held`; returns their session token.
    async fn player(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn save(db: &PgPool, token: &str, steamid: &str, body: Value) -> TestResponse {
        let request = Request::put(format!("/v1/players/{steamid}/details"))
            .header("origin", "https://sourcejump.test")
            .header("content-type", "application/json")
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(Body::from(body.to_string()))
            .unwrap();
        test_client::send(db, request).await
    }

    async fn profile(db: &PgPool, steamid: &str) -> Value {
        test_client::get(db, &format!("/v1/players/{steamid}"))
            .await
            .json()
    }

    #[test]
    fn text_is_one_tidy_line_without_links_or_hidden_characters() {
        assert_eq!(clean_text("  Zowie   EC2 "), Ok(Some("Zowie EC2".into())));
        assert_eq!(clean_text("   "), Ok(None));
        assert!(clean_text("a\nb").is_err());
        assert!(clean_text("evil\u{202E}txt").is_err());
        assert!(clean_text("visit www.spam.example").is_err());
        assert!(clean_text("https://spam.example").is_err());
        assert!(clean_text(&"x".repeat(49)).is_err());
        assert_eq!(
            Aspect::in_old_text("Widescreen 16x10"),
            Some(Aspect::SixteenByTen)
        );
        assert_eq!(Aspect::in_old_text("1920x1080"), None);
    }

    #[sqlx::test]
    async fn players_set_their_own_details_and_country(db: PgPool) {
        let token = player(&db, GABE, &[]).await;
        let body = json!({
            "mouse": " Zowie  EC2 ", "dpi": 800, "sensitivity": 1.234_56, "aspect": "4:3",
            "country_code": "se"
        });
        assert_eq!(save(&db, &token, GABE, body).await.status, 204);
        let shown = profile(&db, GABE).await;
        assert_eq!(
            shown["details"],
            json!({
                "mouse": "Zowie EC2", "dpi": 800, "sensitivity": 1.2346, "mouse_pad": null,
                "keyboard": null, "monitor": null, "aspect": "4:3"
            })
        );
        assert_eq!(
            (
                shown["country_code"].clone(),
                shown["country_chosen"].clone()
            ),
            (json!("SE"), json!(true))
        );

        // Right away again is too soon.
        assert_eq!(save(&db, &token, GABE, json!({})).await.status, 429);
        sqlx::query("UPDATE player_details SET updated_at = now() - interval '1 minute'")
            .execute(&db)
            .await
            .unwrap();
        // Clearing everything shows nothing, and gives the country back to Steam.
        assert_eq!(save(&db, &token, GABE, json!({})).await.status, 204);
        let shown = profile(&db, GABE).await;
        assert_eq!(
            (shown["details"].clone(), shown["country_chosen"].clone()),
            (Value::Null, json!(false))
        );
    }

    #[sqlx::test]
    async fn a_pick_replaces_a_servers_country_and_saving_without_one_keeps_it(db: PgPool) {
        let token = player(&db, GABE, &[]).await;
        sqlx::query("UPDATE players SET country_code = 'SE', country_from_server = true")
            .execute(&db)
            .await
            .unwrap();
        let country = || async {
            sqlx::query_as::<_, (Option<String>, bool, bool)>(
                "SELECT country_code, country_from_server, country_chosen FROM players",
            )
            .fetch_one(&db)
            .await
            .unwrap()
        };

        assert_eq!(
            save(&db, &token, GABE, json!({ "dpi": 800 })).await.status,
            204
        );
        assert_eq!(country().await, (Some("SE".into()), true, false));

        sqlx::query("UPDATE player_details SET updated_at = now() - interval '1 minute'")
            .execute(&db)
            .await
            .unwrap();
        let body = json!({ "country_code": "fi" });
        assert_eq!(save(&db, &token, GABE, body).await.status, 204);
        assert_eq!(country().await, (Some("FI".into()), false, true));
    }

    #[sqlx::test]
    async fn bad_values_are_refused(db: PgPool) {
        let token = player(&db, GABE, &[]).await;
        for body in [
            json!({ "dpi": 10 }),
            json!({ "sensitivity": 0 }),
            json!({ "sensitivity": 1000 }),
            json!({ "aspect": "3:2" }),
            json!({ "country_code": "XX" }),
            json!({ "keyboard": "buy at www.spam.example" }),
            json!({ "name": "not a field" }),
        ] {
            assert_eq!(
                save(&db, &token, GABE, body.clone()).await.status,
                422,
                "{body}"
            );
        }
    }

    #[sqlx::test]
    async fn only_staff_change_others_details_with_a_reason_and_a_log_entry(db: PgPool) {
        let gabe = player(&db, GABE, &[]).await;
        let nova = player(&db, NOVA, &[Privilege::ManageBans]).await;
        save(&db, &gabe, GABE, json!({ "mouse": "rude words" })).await;

        assert_eq!(save(&db, &gabe, NOVA, json!({})).await.status, 403);
        assert_eq!(save(&db, &nova, GABE, json!({})).await.status, 422);
        assert_eq!(
            save(&db, &nova, GABE, json!({ "reason": "Rude" }))
                .await
                .status,
            204
        );
        assert_eq!(profile(&db, GABE).await["details"], Value::Null);
        let detail: Value = sqlx::query_scalar(
            "SELECT detail FROM staff_log WHERE action = 'edit_player_details' AND target = $1",
        )
        .bind(GABE)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(detail["changed"], json!(["mouse"]));
        assert_eq!(detail["before"]["mouse"], json!("rude words"));
    }

    #[sqlx::test]
    async fn a_ban_from_profile_edits_stops_saves(db: PgPool) {
        let token = player(&db, GABE, &[]).await;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "WITH entry AS (INSERT INTO staff_log (action, target, reason) VALUES ('ban_player', '{GABE}', 'x') RETURNING id)
             INSERT INTO bans (player_steamid64, restrictions, reason, log_id) SELECT {GABE}, 4, 'x', id FROM entry"
        )))
        .execute(&db)
        .await
        .unwrap();
        assert_eq!(
            save(&db, &token, GABE, json!({ "dpi": 800 })).await.status,
            403
        );
    }

    #[sqlx::test]
    async fn old_site_details_show_until_a_player_saves_their_own(db: PgPool) {
        let token = player(&db, GABE, &[]).await;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO legacy_players (steamid64, name, setup_mouse, setup_dpi, setup_sens, setup_aspect)
             VALUES ({GABE}, 'gabe', 'G Pro', '800', '1.3 0.044yaw', '16x9')"
        )))
        .execute(&db)
        .await
        .unwrap();
        let shown = profile(&db, GABE).await;
        assert_eq!(shown["details_from_old_site"], json!(true));
        assert_eq!(
            (
                shown["details"]["mouse"].clone(),
                shown["details"]["dpi"].clone(),
                shown["details"]["sensitivity"].clone(),
                shown["details"]["aspect"].clone()
            ),
            (json!("G Pro"), json!(800), Value::Null, json!("16:9"))
        );
        save(&db, &token, GABE, json!({ "dpi": 400 })).await;
        let shown = profile(&db, GABE).await;
        assert_eq!(
            (
                shown["details_from_old_site"].clone(),
                shown["details"]["mouse"].clone()
            ),
            (json!(false), Value::Null)
        );
    }
}
