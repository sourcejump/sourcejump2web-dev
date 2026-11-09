//! A player's runs on one map, style and track, `GET /v1/players/{player}/runs`: every valid 2.0 run behind
//! a personal best, fastest first, for the profile's runs dialog. Read through the `runs_player_board` index.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::SteamId64;
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct PlayerRunsQuery {
    /// Map name.
    map: String,
    /// Style key.
    style: String,
    /// 0 is the main track, 1 and up are bonuses. Default 0.
    track: Option<i16>,
    /// 1 to 100. Default 50: the fastest that many.
    limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerRunPage {
    /// Fastest first; equal times by when they were finished.
    pub runs: Vec<PlayerRun>,
    /// All of their valid runs there, which may be more than `runs` holds.
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerRun {
    pub run_id: i64,
    /// Seconds.
    pub time: f64,
    pub finished_at: DateTime<Utc>,
    pub server_id: i64,
    pub server_name: String,
}

/// The player's valid runs on one map, style and track, fastest first. Takes any `SteamID` form, like the profile.
#[utoipa::path(
    get,
    path = "/v1/players/{player}/runs",
    tag = "players",
    params(
        ("player" = String, Path, description = "SteamID64, SteamID2 (STEAM_0:1:2) or SteamID3 ([U:1:4])"),
        PlayerRunsQuery,
    ),
    responses(
        (status = OK, body = PlayerRunPage),
        (status = NOT_FOUND, description = "SourceJump has no such player or map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID, or not a valid limit", body = ErrorBody),
    ),
)]
pub async fn player_runs(
    State(state): State<AppState>,
    Path(player): Path<String>,
    Query(query): Query<PlayerRunsQuery>,
) -> Result<Json<PlayerRunPage>, ApiError> {
    let steamid64 = SteamId64::parse_any(&player)
        .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID")))?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let found = sqlx::query!(
        r#"SELECT EXISTS (SELECT 1 FROM players WHERE steamid64 = $1) AS "player!",
                  (SELECT id FROM maps WHERE name = $2) AS map_id"#,
        steamid64.get(),
        query.map
    )
    .fetch_one(&state.db)
    .await?;
    if !found.player {
        return Err(ApiError::NotFound("SourceJump has no such player"));
    }
    let map_id = found
        .map_id
        .ok_or(ApiError::NotFound("SourceJump has no such map"))?;
    let track = query.track.unwrap_or(0);

    let total = sqlx::query_scalar!(
        r#"SELECT count(*) AS "total!" FROM runs
           WHERE player_steamid64 = $1 AND map_id = $2 AND style = $3 AND track = $4
             AND invalidated_at IS NULL"#,
        steamid64.get(),
        map_id,
        query.style,
        track
    )
    .fetch_one(&state.db)
    .await?;
    let runs = sqlx::query_as!(
        PlayerRun,
        r#"SELECT r.id AS run_id, r.time, r.finished_at, s.id AS server_id, s.name AS server_name
           FROM runs r
           JOIN servers s ON s.id = r.server_id
           WHERE r.player_steamid64 = $1 AND r.map_id = $2 AND r.style = $3 AND r.track = $4
             AND r.invalidated_at IS NULL
           ORDER BY r.time, r.finished_at, r.id
           LIMIT $5"#,
        steamid64.get(),
        map_id,
        query.style,
        track,
        limit
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(PlayerRunPage { runs, total }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::PlayerRunPage;
    use crate::{
        runs::{
            invalidation,
            tests::{run, setup},
        },
        test_client,
    };

    #[sqlx::test]
    async fn lists_valid_runs_on_one_board_fastest_first(db: PgPool) {
        let key = setup(&db).await;
        for (id, time) in [("a", 30.0), ("b", 25.0), ("c", 28.0)] {
            test_client::post(&db, "/v1/runs", Some(&key), &run(id, time)).await;
        }
        // Another track and another style stay out.
        let mut bonus = run("d", 10.0);
        bonus["track"] = json!(1);
        test_client::post(&db, "/v1/runs", Some(&key), &bonus).await;
        let invalid: i64 = sqlx::query_scalar("SELECT id FROM runs WHERE server_run_id = 'c'")
            .fetch_one(&db)
            .await
            .unwrap();
        let log_id: i64 = sqlx::query_scalar(
            "INSERT INTO staff_log (action, target, reason) VALUES ('invalidate_run', 'c', 'x') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        invalidation::invalidate(&mut db.acquire().await.unwrap(), &[invalid], log_id)
            .await
            .unwrap();

        let page: PlayerRunPage = test_client::get(
            &db,
            "/v1/players/76561197960287930/runs?map=bhop_badges&style=normal",
        )
        .await
        .json();
        let times: Vec<f64> = page.runs.iter().map(|r| r.time).collect();
        assert_eq!((times, page.total), (vec![25.0, 30.0], 2));
        assert_eq!(page.runs[0].server_name, "Test server");

        let one: PlayerRunPage = test_client::get(
            &db,
            "/v1/players/76561197960287930/runs?map=bhop_badges&style=normal&limit=1",
        )
        .await
        .json();
        assert_eq!((one.runs.len(), one.total), (1, 2));
    }

    #[sqlx::test]
    async fn unknown_players_and_maps(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        for (path, status) in [
            (
                "/v1/players/76561197960287931/runs?map=bhop_badges&style=normal",
                404,
            ),
            (
                "/v1/players/76561197960287930/runs?map=bhop_nowhere&style=normal",
                404,
            ),
            ("/v1/players/nova/runs?map=bhop_badges&style=normal", 422),
            (
                "/v1/players/76561197960287930/runs?map=bhop_badges&style=normal&limit=0",
                422,
            ),
        ] {
            assert_eq!(test_client::get(&db, path).await.status, status, "{path}");
        }
    }
}
