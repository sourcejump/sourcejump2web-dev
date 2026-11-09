//! A map's records, `GET /v1/maps/{map}/records`: the top personal bests per style and track, for the
//! plugin's in-game records display. Connected players' own bests on the map are in `records/personal_bests.rs`.

pub mod personal_bests;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::MapName,
    replays::current_policy,
};

const DEFAULT_LIMIT: i64 = 10;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct RecordsQuery {
    /// How many places per style and track, 1 to 100. Default 10.
    limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapRecords {
    pub map: String,
    /// Sorted by style, track and rank. One flat list keeps it simple to read in SourcePawn.
    pub records: Vec<Record>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Record {
    pub style: String,
    pub track: i16,
    /// Equal times share a rank.
    pub rank: i64,
    /// SteamID64, as a string.
    pub steamid64: String,
    /// The player's latest name.
    pub name: String,
    /// Seconds.
    pub time: f64,
    pub run_id: i64,
    pub finished_at: DateTime<Utc>,
    /// Whether `GET /v1/replays/{run_id}` serves this run's replay: it's stored and its style's replays are public.
    pub has_replay: bool,
    /// What this personal best earns (`docs/site-api.md`); 0 on an untiered track.
    pub points: f64,
}

pub fn routes() -> OpenApiRouter<AppState> {
    // Servers check a map's records and their players' personal bests on every map change; most of the time
    // nothing's new.
    OpenApiRouter::new()
        .routes(routes!(map_records))
        .routes(routes!(personal_bests::players_personal_bests))
        .layer(axum::middleware::from_fn(crate::etag::conditional))
}

/// The map's top times per style and track. A map nobody has run yet has an empty list.
#[utoipa::path(
    get,
    path = "/v1/maps/{map}/records",
    tag = "maps",
    params(("map" = String, Path, description = "Map name"), RecordsQuery),
    responses(
        (status = OK, body = MapRecords),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name or limit", body = ErrorBody),
    ),
)]
async fn map_records(
    State(state): State<AppState>,
    Path(map): Path<String>,
    Query(query): Query<RecordsQuery>,
) -> Result<Json<MapRecords>, ApiError> {
    let map = MapName::try_from(map).map_err(ApiError::Invalid)?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }

    let mut conn = state.db.acquire().await?;
    let mut records = sqlx::query_as!(
        Record,
        r#"
        SELECT style AS "style!", track AS "track!", rank AS "rank!", steamid64::text AS "steamid64!",
               name AS "name!", time AS "time!", run_id AS "run_id!", finished_at AS "finished_at!",
               stored AS "has_replay!", points AS "points!"
        FROM (
            SELECT pb.style, pb.track, pb.time, pb.run_id,
                   personal_best_points(pb.map_id, pb.style, pb.track, pb.time) AS points,
                   p.steamid64, p.name, r.finished_at,
                   rp.stored_key IS NOT NULL AS stored,
                   rank() OVER (PARTITION BY pb.style, pb.track ORDER BY pb.time) AS rank
            FROM personal_bests pb
            JOIN maps m ON m.id = pb.map_id
            JOIN players p ON p.steamid64 = pb.player_steamid64
            JOIN runs r ON r.id = pb.run_id
            LEFT JOIN replays rp ON rp.run_id = pb.run_id
            WHERE m.name = $1
        ) ranked
        WHERE rank <= $2
        ORDER BY style, track, rank, finished_at
        "#,
        map.as_str(),
        limit
    )
    .fetch_all(&mut *conn)
    .await?;
    // Same rule as the download, so the plugin never asks for a replay it would get a 404 for.
    let policy = current_policy(&mut conn).await?;
    for record in &mut records {
        record.has_replay &= policy.is_public(&record.style);
    }

    Ok(Json(MapRecords {
        map: map.into(),
        records,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::MapRecords;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn ranks_personal_bests_per_style_and_track(db: PgPool) {
        let key = setup(&db).await;
        let mut runs = [
            run("a", 30.0),
            run("b", 28.0),
            run("c", 29.0),
            run("d", 29.0),
        ];
        // b is the first player's faster run; c and d are two more players who tie.
        runs[2]["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        runs[3]["player"] = json!({ "steamid64": "76561197960287932", "name": "third" });
        let mut bonus = run("e", 50.0);
        bonus["track"] = json!(1);
        let mut elsewhere = run("f", 10.0);
        elsewhere["map"] = json!("bhop_other");
        for body in runs.iter().chain([&bonus, &elsewhere]) {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), body)
                    .await
                    .status,
                201
            );
        }

        let records: MapRecords = test_client::get(&db, "/v1/maps/bhop_badges/records")
            .await
            .json();

        let summary: Vec<_> = records
            .records
            .iter()
            .map(|r| (r.track, r.rank, r.name.as_str(), r.time))
            .collect();
        assert_eq!(
            summary,
            [
                (0, 1, "gabe", 28.0),
                (0, 2, "second", 29.0),
                (0, 2, "third", 29.0),
                (1, 1, "gabe", 50.0)
            ]
        );
    }

    #[sqlx::test]
    async fn the_limit_applies_per_style_and_track(db: PgPool) {
        let key = setup(&db).await;
        let mut second = run("b", 31.0);
        second["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        test_client::post(&db, "/v1/runs", Some(&key), &second).await;

        let top_one: MapRecords = test_client::get(&db, "/v1/maps/bhop_badges/records?limit=1")
            .await
            .json();
        let unknown_map: MapRecords = test_client::get(&db, "/v1/maps/bhop_none/records")
            .await
            .json();

        assert_eq!(top_one.records.len(), 1);
        assert!(unknown_map.records.is_empty());
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_badges/records?limit=0")
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn a_known_answer_comes_back_as_304_until_a_run_lands(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let get = |etag: Option<String>| {
            let db = db.clone();
            async move {
                let mut request = axum::http::Request::get("/v1/maps/bhop_badges/records");
                if let Some(etag) = etag {
                    request = request.header("if-none-match", etag);
                }
                test_client::send(&db, request.body(axum::body::Body::empty()).unwrap()).await
            }
        };

        let first = get(None).await;
        let etag = first.headers["etag"].to_str().unwrap().to_owned();
        let again = get(Some(etag.clone())).await;
        assert_eq!((again.status, again.body.len()), (304, 0));

        test_client::post(&db, "/v1/runs", Some(&key), &run("b", 29.0)).await;
        let changed = get(Some(etag)).await;
        assert_eq!(changed.status, 200);
    }

    #[sqlx::test]
    async fn has_replay_follows_storage_and_public_styles(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let has_replay = |db: PgPool| async move {
            let records: MapRecords = test_client::get(&db, "/v1/maps/bhop_badges/records")
                .await
                .json();
            records.records[0].has_replay
        };

        let requested = has_replay(db.clone()).await;
        // Mark it stored, as the processing job would.
        sqlx::query(
            "UPDATE replays SET stored_key = 'replays/1.sjr', stored_at = now(), raw_bytes = 1, stored_bytes = 1",
        )
        .execute(&db)
        .await
        .unwrap();
        let stored = has_replay(db.clone()).await;
        // A newer policy that makes no style public: the download would refuse it, so records say no.
        sqlx::query(
            r#"INSERT INTO policies (name, version, value)
               VALUES ('replays', 99, '{"request": "new_personal_best", "public_styles": []}')"#,
        )
        .execute(&db)
        .await
        .unwrap();

        assert!(!requested);
        assert!(stored);
        assert!(!has_replay(db).await);
    }
}
