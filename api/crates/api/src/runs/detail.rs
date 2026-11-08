//! One run, `GET /v1/runs/{id}`: everything public about it, for the run dialog and `/runs/{id}` pages.
//!
//! Any run opens by its ID, including runs that are no longer a personal best (lead, 2026-10-19) and runs
//! staff invalidated, which say so without the reason (lead, 2026-10-20). The compliance report and the key
//! it was sent with stay private.

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
    maps::{image::MapImage, tiers},
    players::PlayerRef,
    replays::download::{RunReplay, public_replay},
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunDetail {
    pub id: i64,
    pub player: PlayerRef,
    pub map: String,
    /// The map's cover picture. None until staff add one.
    pub map_image: Option<MapImage>,
    pub style: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    /// The board's tier. None while tiers aren't in force or staff haven't set this board's.
    pub tier: Option<i16>,
    /// Number of tiers in force; None while the community hasn't set tiers.
    pub tier_count: Option<i16>,
    /// Seconds.
    pub time: f64,
    pub jumps: i32,
    pub strafes: i32,
    /// Percent, 0–100.
    pub sync: f32,
    /// Percent of perfect jumps, 0–100.
    pub perfs: f32,
    /// Units per second.
    pub avg_velocity: f32,
    /// Units per second.
    pub max_velocity: f32,
    pub tickrate: f32,
    /// By the game server's clock.
    pub finished_at: DateTime<Utc>,
    pub server_id: i64,
    pub server_name: String,
    /// `ip:port` players connect to, from the server's latest heartbeat. None unless staff listed that address,
    /// as on `GET /v1/servers`: unlisted addresses stay private.
    pub server_address: Option<String>,
    /// The ruleset version the run was played under.
    pub ruleset_version: i32,
    /// Whether staff took this run off the boards. An invalidated run is never a personal best.
    pub invalidated: bool,
    /// Whether this run is the player's current personal best on its map, style and track.
    pub personal_best: bool,
    /// Its place on the leaderboard while it's a personal best. None once it's superseded.
    pub rank: Option<i64>,
    /// The leaderboard's current record time. None when the board has no valid run left.
    pub world_record_time: Option<f64>,
    /// Present when the replay is stored and its style's replays are public, invalidated runs included, so
    /// anyone can watch why. `GET /v1/replays/{run_id}` still refuses an invalidated run's file.
    pub replay: Option<RunReplay>,
}

/// One run by SourceJump's ID.
#[utoipa::path(
    get,
    path = "/v1/runs/{id}",
    tag = "runs",
    params(("id" = i64, Path, description = "SourceJump's run ID")),
    responses(
        (status = OK, body = RunDetail),
        (status = NOT_FOUND, description = "SourceJump has no such run", body = ErrorBody),
    ),
)]
pub async fn run_detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<RunDetail>, ApiError> {
    let row = sqlx::query!(
        r#"
        SELECT r.id, r.map_id, m.name AS map, r.style, r.track, r.time, r.jumps, r.strafes, r.sync, r.perfs,
               r.avg_velocity, r.max_velocity, r.tickrate, r.finished_at, r.ruleset_version,
               r.invalidated_at IS NOT NULL AS "invalidated!", s.id AS server_id, s.name AS server_name,
               p.steamid64::text AS "steamid64!", p.name, p.avatar_url, p.country_code,
               EXISTS (SELECT 1 FROM personal_bests WHERE run_id = r.id) AS "personal_best!",
               (SELECT min(time) FROM personal_bests
                WHERE map_id = r.map_id AND style = r.style AND track = r.track) AS world_record_time,
               (SELECT tier FROM current_map_tiers WHERE map_id = r.map_id AND track = r.track) AS tier,
               ci.id AS "image_id?", ci.key AS "image_key?", ci.focus AS "image_focus?",
               (SELECT host(h.ip) || ':' || h.port FROM server_heartbeats h
                JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
                WHERE h.server_id = s.id ORDER BY h.received_at DESC LIMIT 1) AS server_address
        FROM runs r
        JOIN maps m ON m.id = r.map_id
        LEFT JOIN map_images ci ON ci.map_id = m.id AND ci.position = 0
        JOIN servers s ON s.id = r.server_id
        JOIN players p ON p.steamid64 = r.player_steamid64
        WHERE r.id = $1
        "#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound("SourceJump has no such run"))?;

    // Equal times share a place, so the place is one more than the number of faster personal bests.
    let rank = if row.personal_best {
        Some(
            sqlx::query_scalar!(
                r#"SELECT count(*) + 1 AS "rank!" FROM personal_bests
                   WHERE map_id = $1 AND style = $2 AND track = $3 AND time < $4"#,
                row.map_id,
                row.style,
                row.track,
                row.time
            )
            .fetch_one(&state.db)
            .await?,
        )
    } else {
        None
    };

    let tier_count = tiers::tier_count(&state.db).await?;
    let replay = public_replay(&mut *state.db.acquire().await?, row.id)
        .await?
        .map(|replay| RunReplay {
            sjr_url: state.storage.public_url(&replay.stored_key),
            size: replay.size,
            route: replay.route,
        });

    Ok(Json(RunDetail {
        id: row.id,
        player: PlayerRef {
            steamid64: row.steamid64,
            name: row.name,
            avatar_url: row.avatar_url,
            country_code: row.country_code,
        },
        map: row.map,
        map_image: MapImage::cover(&state.storage, row.image_id, row.image_key, row.image_focus),
        style: row.style,
        track: row.track,
        // Tiers assigned before a tier count was published aren't in force.
        tier: row.tier.filter(|_| tier_count.is_some()),
        tier_count,
        time: row.time,
        jumps: row.jumps,
        strafes: row.strafes,
        sync: row.sync,
        perfs: row.perfs,
        avg_velocity: row.avg_velocity,
        max_velocity: row.max_velocity,
        tickrate: row.tickrate,
        finished_at: row.finished_at,
        server_id: row.server_id,
        server_name: row.server_name,
        server_address: row.server_address,
        ruleset_version: row.ruleset_version,
        invalidated: row.invalidated,
        personal_best: row.personal_best,
        rank,
        world_record_time: row.world_record_time,
        replay,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::RunDetail;
    use crate::{
        runs::{
            RunAccepted,
            tests::{run, setup},
        },
        test_client,
    };

    async fn submit(db: &PgPool, key: &str, body: &serde_json::Value) -> i64 {
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(key), body)
            .await
            .json();
        accepted.id
    }

    #[sqlx::test]
    async fn shows_a_run_with_its_place(db: PgPool) {
        let key = setup(&db).await;
        let mut faster = run("b", 20.0);
        faster["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        submit(&db, &key, &faster).await;
        let first = submit(&db, &key, &run("a", 30.0)).await;
        let improved = submit(&db, &key, &run("c", 25.0)).await;

        let current: RunDetail = test_client::get(&db, &format!("/v1/runs/{improved}"))
            .await
            .json();
        let superseded: RunDetail = test_client::get(&db, &format!("/v1/runs/{first}"))
            .await
            .json();

        assert_eq!(current.player.name, "gabe");
        assert_eq!((current.map.as_str(), current.time), ("bhop_badges", 25.0));
        assert_eq!(current.server_name, "Test server");
        // The test server was never listed, so its address stays private.
        assert_eq!(current.server_address, None);
        assert!(current.personal_best);
        assert_eq!(current.rank, Some(2));
        assert_eq!(current.world_record_time, Some(20.0));
        assert!(!current.invalidated);
        assert!(!superseded.personal_best);
        assert_eq!(superseded.rank, None);
        assert_eq!(test_client::get(&db, "/v1/runs/999999").await.status, 404);
    }
}
