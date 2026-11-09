//! Maps, identified by their lowercase name, and the map pages' endpoints: the map list, a map's details,
//! its leaderboards and its WR history, each map's file for the web viewer, and the stock content it draws on.

pub mod card;
mod detail;
pub mod image;
mod leaderboard;
mod list;
pub mod release;
pub(crate) use list::default_style;
pub mod stock_content;
pub mod tiers;
pub mod viewer_file;
pub mod wr_history;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, players::PlayerRef};

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list::list_maps))
        .routes(routes!(detail::map_detail))
        .routes(routes!(wr_history::wr_history))
        // Game servers read leaderboards for `/wr` on every map change; most of the time nothing's new.
        .merge(
            OpenApiRouter::new()
                .routes(routes!(leaderboard::map_leaderboard))
                .layer(axum::middleware::from_fn(crate::etag::conditional)),
        )
}

/// The fastest personal best on a map, style and track. When times tie, the one set first holds it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WorldRecord {
    pub player: PlayerRef,
    /// Seconds.
    pub time: f64,
    pub run_id: i64,
    pub finished_at: DateTime<Utc>,
}

/// Paging for list endpoints: `limit` from 1 to `max`, `offset` from 0.
/// Maps with at least one run: the map list's length, and what completed maps are counted out of.
pub(crate) async fn played_count(db: &sqlx::PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM maps WHERE last_run_at IS NOT NULL"#)
        .fetch_one(db)
        .await
}

pub(crate) fn check_page(limit: i64, offset: i64, max: i64) -> Result<(), String> {
    if !(1..=max).contains(&limit) {
        return Err(format!("limit must be between 1 and {max}"));
    }
    if offset < 0 {
        return Err("offset can't be negative".to_owned());
    }
    Ok(())
}

/// A map name as shavit reports it: lowercase letters, digits, `_`, `-` and `.`, at most 64 characters, and
/// not only dots. Input is lowercased first, so `bhop_Badges` and `bhop_badges` are the same map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct MapName(String);

impl MapName {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for MapName {
    type Error = String;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        let name = text.to_lowercase();
        let allowed = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || "_-.".contains(c);
        // Names go into storage keys and URL paths, where `.` and `..` mean this folder and the one above.
        let only_dots = name.chars().all(|c| c == '.');
        if name.is_empty() || name.len() > 64 || !name.chars().all(allowed) || only_dots {
            return Err(format!("{text:?} is not a valid map name"));
        }
        Ok(Self(name))
    }
}

impl From<MapName> for String {
    fn from(name: MapName) -> Self {
        name.0
    }
}

/// The map's ID, adding the map on first sight. Any keyed server can add a map by submitting a run on it;
/// which maps are ranked is a separate, staff-managed decision.
pub async fn id_for(conn: &mut PgConnection, name: &MapName) -> Result<i64, sqlx::Error> {
    // The no-op update makes RETURNING yield the ID of an existing row too.
    sqlx::query_scalar!(
        "INSERT INTO maps (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id",
        name.as_str()
    )
    .fetch_one(conn)
    .await
}

/// Notes a run on the map, so the map list knows when it was last played and, from its first run, when it
/// joined the list. A run sent late from a queue can't move either back.
pub async fn record_run(
    conn: &mut PgConnection,
    map_id: i64,
    finished_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE maps SET last_run_at = greatest(last_run_at, $2), listed_at = coalesce(listed_at, now()) WHERE id = $1",
        map_id,
        finished_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Recounts `maps.players` for these runs' maps, after their personal bests changed. Callers hold those maps'
/// rows, so a personal best written there meanwhile either waits for this transaction or has committed and is
/// counted.
pub async fn count_players(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE maps m SET players = (SELECT count(DISTINCT player_steamid64) FROM personal_bests WHERE map_id = m.id)
        WHERE m.id IN (SELECT map_id FROM runs WHERE id = ANY($1))
        "#,
        run_ids
    )
    .execute(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::MapName;

    #[test]
    fn map_names_are_lowercased_and_checked() {
        let parse = |text: &str| MapName::try_from(text.to_owned());

        assert_eq!(parse("bhop_Badges").unwrap().as_str(), "bhop_badges");
        assert!(parse("bhop_arcane_v1.2").is_ok());
        assert!(parse("../etc/passwd").is_err());
        assert!(parse("bhop badges").is_err());
        assert!(parse("").is_err());
        for dots in [".", "..", "..."] {
            assert!(parse(dots).is_err(), "{dots}");
        }
        assert!(
            parse(".bhop.").is_ok(),
            "dots among other characters are fine"
        );
    }
}
