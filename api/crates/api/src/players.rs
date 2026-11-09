//! Players, identified by SteamID64.

mod avatar;
pub mod countries;
mod details;
mod list;
mod personal_bests;
pub mod privileges;
mod profile;
pub mod restrictions;
pub mod steam_profile;

use std::fmt;

use chrono::{DateTime, Utc};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list::list_players))
        .routes(routes!(profile::player_profile))
        .routes(routes!(avatar::player_avatar))
        .routes(routes!(personal_bests::player_personal_bests))
        .routes(routes!(details::update_player_details))
        .routes(routes!(countries::list_countries))
}

/// A player as leaderboards, records and runs show them: enough to draw their name, avatar and flag, and to
/// link to their profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PlayerRef {
    /// SteamID64, as a string.
    pub steamid64: String,
    /// Their latest name.
    pub name: String,
    pub avatar_url: Option<String>,
    /// ISO 3166-1 alpha-2, from their Steam profile.
    pub country_code: Option<String>,
}

impl PlayerRef {
    /// From a `LEFT JOIN players`'s columns: none when the join found no player.
    pub fn joined(
        steamid64: Option<String>,
        name: Option<String>,
        avatar_url: Option<String>,
        country_code: Option<String>,
    ) -> Option<Self> {
        Some(Self {
            steamid64: steamid64?,
            name: name?,
            avatar_url,
            country_code,
        })
    }
}

/// A Steam account ID in its 64-bit form, checked to be an individual account in the public universe.
///
/// Sent and served as a JSON string: the value doesn't fit in a JavaScript number, and SourcePawn has no
/// 64-bit integers, so the plugin handles it as text anyway. Stored as `bigint`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SteamId64(i64);

// Universe 1 (public), account type 1 (individual), instance 1 (desktop); the low 32 bits are the account number.
pub const INDIVIDUAL_BASE: u64 = 0x0110_0001_0000_0000;

impl SteamId64 {
    pub fn get(self) -> i64 {
        self.0
    }

    /// Reads a `SteamID` in any form people paste: `SteamID64`, `SteamID2` (`STEAM_0:1:11101`) or `SteamID3`
    /// (`[U:1:22203]`). The API's own fields only take SteamID64; this is for search and profile URLs.
    pub fn parse_any(text: &str) -> Option<Self> {
        let text = text.trim();
        let account = if let Some(rest) = text.strip_prefix("STEAM_") {
            // STEAM_X:Y:Z, where X is the universe (0 and 1 both mean public) and the account is Z * 2 + Y.
            let mut parts = rest.split(':');
            let (Some(universe), Some(y), Some(z), None) =
                (parts.next(), parts.next(), parts.next(), parts.next())
            else {
                return None;
            };
            if !matches!(universe, "0" | "1") || !matches!(y, "0" | "1") {
                return None;
            }
            z.parse::<u32>()
                .ok()?
                .checked_mul(2)?
                .checked_add(y.parse().ok()?)?
        } else if let Some(rest) = text.strip_prefix("[U:1:") {
            rest.strip_suffix(']')?.parse::<u32>().ok()?
        } else {
            return Self::try_from(text.to_owned()).ok();
        };
        Self::try_from((INDIVIDUAL_BASE + u64::from(account)).to_string()).ok()
    }
}

impl TryFrom<String> for SteamId64 {
    type Error = String;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        let invalid = || format!("{text:?} is not the SteamID64 of a player account");
        let value: u64 = text.parse().map_err(|_| invalid())?;
        if value <= INDIVIDUAL_BASE || value > INDIVIDUAL_BASE + u64::from(u32::MAX) {
            return Err(invalid());
        }
        Ok(Self(i64::try_from(value).map_err(|_| invalid())?))
    }
}

impl From<SteamId64> for String {
    fn from(id: SteamId64) -> Self {
        id.to_string()
    }
}

impl fmt::Display for SteamId64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// Adds a player we know only by Steam ID, such as one signing in before they've played. The ID stands in
/// for a name until Steam's profile or a run gives one; the oldest possible time lets either replace it.
pub async fn ensure_exists(db: &sqlx::PgPool, steamid64: SteamId64) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1::bigint, $1::bigint::text, '-infinity') ON CONFLICT DO NOTHING",
        steamid64.get()
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Adds the player, or updates their name if `seen_at` is newer than the name we have. A run sent late from
/// a server's queue can't roll a name back.
pub async fn record_name(
    conn: &mut PgConnection,
    steamid64: SteamId64,
    name: &str,
    seen_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1, $2, $3)
        ON CONFLICT (steamid64) DO UPDATE SET name = excluded.name, name_seen_at = excluded.name_seen_at
        WHERE players.name_seen_at < excluded.name_seen_at
        "#,
        steamid64.get(),
        name,
        seen_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Makes `code`, found by a game server from the player's address, their country, replacing one they picked or
/// Steam's (the order is in `docs/site-api.md`). Only from their latest run, as for names: `record_name` has
/// already moved `name_seen_at` to the newest time a server saw them, so a run sent late from a queue can't roll
/// the country back.
pub async fn record_server_country(
    conn: &mut PgConnection,
    steamid64: SteamId64,
    code: &str,
    finished_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE players SET country_code = $2, country_from_server = true, country_chosen = false
        WHERE steamid64 = $1 AND name_seen_at <= $3
          AND (country_code IS DISTINCT FROM $2 OR NOT country_from_server)
        "#,
        steamid64.get(),
        code,
        finished_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::SteamId64;

    #[test]
    fn accepts_player_accounts_only() {
        let parse = |text: &str| SteamId64::try_from(text.to_owned());

        assert_eq!(
            parse("76561197960287930").unwrap().get(),
            76_561_197_960_287_930
        );
        assert!(parse("76561197960265728").is_err(), "account number 0");
        assert!(parse("103582791429521408").is_err(), "a Steam group");
        assert!(parse("STEAM_0:1:11101").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn reads_steamid2_and_steamid3() {
        let expected = SteamId64::try_from("76561197960287930".to_owned()).ok();

        assert_eq!(SteamId64::parse_any("STEAM_0:0:11101"), expected);
        assert_eq!(SteamId64::parse_any("STEAM_1:0:11101"), expected);
        assert_eq!(SteamId64::parse_any("[U:1:22202]"), expected);
        assert_eq!(SteamId64::parse_any(" 76561197960287930 "), expected);
        assert_eq!(SteamId64::parse_any("STEAM_0:2:11101"), None);
        assert_eq!(
            SteamId64::parse_any("STEAM_0:0:0"),
            None,
            "account number 0"
        );
        assert_eq!(SteamId64::parse_any("[U:1:x]"), None);
        assert_eq!(SteamId64::parse_any("nova"), None);
    }
}
