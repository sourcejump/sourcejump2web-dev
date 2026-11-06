//! A map's WR history, `GET /v1/maps/{map}/wr-history`: every run that beat the record of its time, for one
//! style and track.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};

use super::MapName;
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::PlayerRef,
};

#[derive(Debug, Deserialize, IntoParams)]
pub struct WrHistoryQuery {
    /// Style key.
    style: String,
    /// 0 is the main track (the default), 1 and up are bonuses.
    track: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WrHistory {
    pub map: String,
    pub style: String,
    pub track: i16,
    /// Oldest first; the last one is the current world record.
    pub records: Vec<WrHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct WrHistoryEntry {
    pub player: PlayerRef,
    /// Seconds.
    pub time: f64,
    pub run_id: i64,
    /// When the record was set, by the game server's clock.
    pub finished_at: DateTime<Utc>,
    /// Seconds faster than the record it beat. None for the first record.
    pub improvement: Option<f64>,
}

/// Every run that was faster than all runs before it, in the order they finished. Equalling the record
/// doesn't count. An unknown map is a 404; a style or track nobody has finished has an empty history.
#[utoipa::path(
    get,
    path = "/v1/maps/{map}/wr-history",
    tag = "maps",
    params(("map" = String, Path, description = "Map name"), WrHistoryQuery),
    responses(
        (status = OK, body = WrHistory),
        (status = NOT_FOUND, description = "SourceJump has no such map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name or track", body = ErrorBody),
    ),
)]
pub async fn wr_history(
    State(state): State<AppState>,
    Path(map): Path<String>,
    Query(query): Query<WrHistoryQuery>,
) -> Result<Json<WrHistory>, ApiError> {
    let map = MapName::try_from(map).map_err(ApiError::Invalid)?;
    let track = query.track.unwrap_or(0);
    if track < 0 {
        return Err(ApiError::Invalid("track can't be negative".to_owned()));
    }
    let map_id = sqlx::query_scalar!("SELECT id FROM maps WHERE name = $1", map.as_str())
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound("SourceJump has no such map"))?;

    let records = records(&state.db, map_id, Some((&query.style, track)))
        .await?
        .into_iter()
        .map(|record| record.entry)
        .collect();

    Ok(Json(WrHistory {
        map: map.into(),
        style: query.style,
        track,
        records,
    }))
}

/// A record with the leaderboard it was set on.
pub(super) struct BoardRecord {
    pub style: String,
    pub track: i16,
    pub entry: WrHistoryEntry,
}

/// The WR history of every leaderboard on the map, or of one style and track, each oldest first.
pub(super) async fn records(
    db: &PgPool,
    map_id: i64,
    board: Option<(&str, i16)>,
) -> Result<Vec<BoardRecord>, sqlx::Error> {
    // The runs that were records when set, as `leaderboards/world_records.rs` stores them: faster than every
    // earlier valid run on the board. Invalidating a run redoes its board, so the runs it had kept from being
    // records become ones.
    let rows = sqlx::query!(
        r#"
        SELECT r.style, r.track, r.id, r.time, r.finished_at,
               p.steamid64::text AS "steamid64!", p.name, p.avatar_url, p.country_code
        FROM runs r
        JOIN players p ON p.steamid64 = r.player_steamid64
        WHERE r.map_id = $1 AND r.was_record
          AND ($2::text IS NULL OR (r.style = $2 AND r.track = $3::smallint))
        ORDER BY r.style, r.track, r.finished_at, r.id
        "#,
        map_id,
        board.map(|(style, _)| style),
        board.map(|(_, track)| track)
    )
    .fetch_all(db)
    .await?;

    let mut previous: Option<(String, i16, f64)> = None;
    Ok(rows
        .into_iter()
        .map(|row| {
            // Rounded to the millisecond, the precision times are shown in, without float noise.
            let improvement = previous
                .as_ref()
                .filter(|(style, track, _)| *style == row.style && *track == row.track)
                .map(|(_, _, before)| ((before - row.time) * 1000.0).round() / 1000.0);
            previous = Some((row.style.clone(), row.track, row.time));
            BoardRecord {
                style: row.style,
                track: row.track,
                entry: WrHistoryEntry {
                    player: PlayerRef {
                        steamid64: row.steamid64,
                        name: row.name,
                        avatar_url: row.avatar_url,
                        country_code: row.country_code,
                    },
                    time: row.time,
                    run_id: row.id,
                    finished_at: row.finished_at,
                    improvement,
                },
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::WrHistory;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn lists_each_record_in_the_order_it_was_set(db: PgPool) {
        let key = setup(&db).await;
        // (time, finished_at): 40 sets the first record, 35 beats it, 38 and the tying 35 don't, 30 does.
        let runs = [
            (40.0, 1_792_400_000),
            (35.0, 1_792_400_100),
            (38.0, 1_792_400_200),
            (35.0, 1_792_400_300),
            (30.0, 1_792_400_400),
        ];
        // Sent out of order, as a queued server might; history follows when runs finished.
        for (index, (time, finished_at)) in runs.into_iter().enumerate().rev() {
            let mut body = run(&format!("r{index}"), time);
            body["finished_at"] = json!(finished_at);
            body["player"] = json!({ "steamid64": format!("7656119796028793{index}"), "name": format!("p{index}") });
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), &body)
                    .await
                    .status,
                201
            );
        }

        let history: WrHistory =
            test_client::get(&db, "/v1/maps/bhop_badges/wr-history?style=normal")
                .await
                .json();

        let records: Vec<_> = history
            .records
            .iter()
            .map(|r| (r.player.name.as_str(), r.time, r.improvement))
            .collect();
        assert_eq!(
            records,
            [
                ("p0", 40.0, None),
                ("p1", 35.0, Some(5.0)),
                ("p4", 30.0, Some(5.0))
            ]
        );
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_none/wr-history?style=normal")
                .await
                .status,
            404
        );
    }
}
