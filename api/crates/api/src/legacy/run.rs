//! One pre-2.0 run, `GET /v1/legacy-runs/{id}`: what the old site kept of it, for the run dialog. Pre-2.0 runs
//! have no run page; this is all there is of them.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::PlayerRef,
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LegacyRunDetail {
    /// The old site's ID for the run, which can equal a 2.0 run's.
    pub id: i64,
    pub map: String,
    /// The player as SourceJump knows them now.
    pub player: PlayerRef,
    /// The name they played under then.
    pub player_name: String,
    /// Seconds.
    pub time: f64,
    /// The fastest pre-2.0 run on the map, banned players' left out.
    pub record_time: f64,
    pub jumps: i32,
    pub strafes: i32,
    /// Percent.
    pub sync: f32,
    /// None for the few dates the old site stored unreadably.
    pub finished_at: Option<DateTime<Utc>>,
    /// The server's name then; its address wasn't kept.
    pub server_name: String,
}

/// A pre-2.0 run. Runs of players banned from records are hidden, as on the boards.
#[utoipa::path(
    get,
    path = "/v1/legacy-runs/{id}",
    tag = "runs",
    params(("id" = i64, Path, description = "The old site's run ID")),
    responses(
        (status = OK, body = LegacyRunDetail),
        (status = NOT_FOUND, description = "No such pre-2.0 run", body = ErrorBody),
    ),
)]
pub async fn legacy_run_detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<LegacyRunDetail>, ApiError> {
    let not_found = || ApiError::NotFound("SourceJump has no such pre-2.0 run");
    let id = i32::try_from(id).map_err(|_| not_found())?;
    let row = sqlx::query!(
        r#"
        SELECT l.id, lm.name AS map, l.player_name, l.time, l.jumps, l.strafes, l.sync, l.finished_at,
               l.server_hostname,
               l.player_steamid64::text AS "steamid64!", coalesce(p.name, lp.name) AS "name!",
               coalesce(p.avatar_url, lp.avatar_url) AS avatar_url,
               coalesce(p.country_code, lp.country_code) AS country_code,
               (SELECT min(o.time) FROM legacy_runs o
                WHERE o.map_id = l.map_id
                  AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = o.player_steamid64)
               ) AS "record_time!"
        FROM legacy_runs l
        JOIN legacy_maps lm ON lm.id = l.map_id
        JOIN legacy_players lp ON lp.steamid64 = l.player_steamid64
        LEFT JOIN players p ON p.steamid64 = l.player_steamid64
        WHERE l.id = $1
          AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
        "#,
        id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(not_found)?;

    Ok(Json(LegacyRunDetail {
        id: i64::from(row.id),
        map: row.map,
        player: PlayerRef {
            steamid64: row.steamid64,
            name: row.name,
            avatar_url: row.avatar_url,
            country_code: row.country_code,
        },
        player_name: row.player_name,
        time: row.time,
        record_time: row.record_time,
        jumps: row.jumps,
        strafes: row.strafes,
        sync: row.sync,
        finished_at: row.finished_at,
        server_name: row.server_hostname,
    }))
}
