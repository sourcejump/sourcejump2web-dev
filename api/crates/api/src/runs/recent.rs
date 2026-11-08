//! The latest runs, `GET /v1/runs`, for the Activity page: valid runs newest first, narrowed by style, track,
//! a lowest tier, or to world records only. Each run says where it placed on its board when it finished.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::{check_page, tiers},
    players::PlayerRef,
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct RecentRunsQuery {
    /// Style key. Left out: every style.
    style: Option<String>,
    /// Left out: both.
    #[param(inline)]
    track: Option<TrackKind>,
    /// Only boards with at least this tier. Boards without a tier are left out once this is set.
    min_tier: Option<i16>,
    /// Only runs that set a world record when they finished.
    records: Option<bool>,
    /// 1 to 100. Default 50.
    limit: Option<i64>,
    /// Continue after this point: a `next_cursor` from an earlier page with the same filters.
    cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    /// Track 0.
    Main,
    /// Tracks 1 and up.
    Bonus,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RecentRuns {
    /// Newest first.
    pub runs: Vec<RecentRun>,
    /// Pass as `cursor` for the runs before these. None at the end.
    pub next_cursor: Option<String>,
    /// Number of tiers in force; None while the community hasn't set tiers, and runs then have no tier.
    pub tier_count: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RecentRun {
    pub run_id: i64,
    pub player: PlayerRef,
    pub map: String,
    pub style: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    /// The board's tier. None while tiers aren't in force or staff haven't set this board's.
    pub tier: Option<i16>,
    /// Seconds.
    pub time: f64,
    /// By the game server's clock.
    pub finished_at: DateTime<Utc>,
    /// Where the run placed on its board when it finished, counting the valid runs before it; equal times
    /// share a place. None when it didn't beat the player's own best, so it never placed.
    pub placement: Option<i64>,
    /// Faster than every valid run before it on the board. Equalling the record doesn't count.
    pub world_record: bool,
    /// Seconds against the board's record when the run finished: negative for a new world record, positive
    /// when slower. None for the board's first run.
    pub gap: Option<f64>,
}

/// The latest valid runs, newest first, a page at a time.
#[utoipa::path(
    get,
    path = "/v1/runs",
    tag = "runs",
    params(RecentRunsQuery),
    responses(
        (status = OK, body = RecentRuns),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid tier, limit or cursor", body = ErrorBody),
    ),
)]
pub async fn recent_runs(
    State(state): State<AppState>,
    Query(query): Query<RecentRunsQuery>,
) -> Result<Json<RecentRuns>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    check_page(limit, 0, MAX_LIMIT).map_err(ApiError::Invalid)?;
    if query.min_tier.is_some_and(|tier| tier < 1) {
        return Err(ApiError::Invalid("min_tier must be 1 or more".to_owned()));
    }
    let after = match &query.cursor {
        None => None,
        Some(cursor) => Some(position(&state.db, cursor).await?),
    };
    let tier_count = tiers::tier_count(&state.db).await?;
    // Tiers assigned before a tier count was published aren't in force, so nothing meets a lowest tier.
    if query.min_tier.is_some() && tier_count.is_none() {
        return Ok(Json(RecentRuns {
            runs: Vec::new(),
            next_cursor: None,
            tier_count,
        }));
    }

    let mut runs = page(&state.db, &query, after, limit + 1, tier_count.is_some()).await?;
    let limit = usize::try_from(limit).expect("checked to be positive");
    let next_cursor = (runs.len() > limit).then(|| {
        runs.truncate(limit);
        runs.last().map(|run| run.run_id.to_string())
    });
    Ok(Json(RecentRuns {
        runs,
        next_cursor: next_cursor.flatten(),
        tier_count,
    }))
}

/// Where a page starts: after the run with this finish time and ID.
type Position = (DateTime<Utc>, i64);

async fn position(db: &PgPool, cursor: &str) -> Result<Position, ApiError> {
    let invalid = || ApiError::Invalid("that cursor isn't from this list".to_owned());
    let run_id: i64 = cursor.parse().map_err(|_| invalid())?;
    let finished_at = sqlx::query_scalar!("SELECT finished_at FROM runs WHERE id = $1", run_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(invalid)?;
    Ok((finished_at, run_id))
}

async fn page(
    db: &PgPool,
    query: &RecentRunsQuery,
    after: Option<Position>,
    limit: i64,
    tiers_in_force: bool,
) -> Result<Vec<RecentRun>, sqlx::Error> {
    let track = query.track.map(|track| match track {
        TrackKind::Main => "main",
        TrackKind::Bonus => "bonus",
    });
    // "Before" a run means earlier on its board in WR history's order: finish time, then ID. Whether a run
    // was a record is the stored `was_record` (`leaderboards/world_records.rs`), which the records filter reads
    // through its own index. `prior`, the
    // board's best before the run, and placements are worked out for the page's runs alone, reading the
    // board's earlier runs through the `runs_map` index.
    let rows = sqlx::query!(
        r#"
        WITH listed AS (
            SELECT r.id, r.map_id, r.style, r.track, r.player_steamid64, r.time, r.finished_at, r.was_record,
                   tier.tier
            FROM runs r
            LEFT JOIN current_map_tiers tier ON $7 AND tier.map_id = r.map_id AND tier.track = r.track
            WHERE r.invalidated_at IS NULL
              AND (NOT $4 OR r.was_record)
              AND ($1::text IS NULL OR r.style = $1)
              AND ($2::text IS NULL OR ($2 = 'main') = (r.track = 0))
              AND ($3::smallint IS NULL OR tier.tier >= $3)
              AND ($5::timestamptz IS NULL OR (r.finished_at, r.id) < ($5, $6::bigint))
            ORDER BY r.finished_at DESC, r.id DESC
            LIMIT $8
        )
        SELECT l.id, l.style, l.track, l.time, l.finished_at, l.was_record, l.tier AS "tier?", prior.best AS "best?",
               m.name AS map, place.placement AS "placement?",
               p.steamid64::text AS "steamid64!", p.name, p.avatar_url, p.country_code
        FROM listed l
        CROSS JOIN LATERAL (
            SELECT min(e.time) AS best FROM runs e
            WHERE e.map_id = l.map_id AND e.style = l.style AND e.track = l.track
              AND e.invalidated_at IS NULL AND (e.finished_at, e.id) < (l.finished_at, l.id)
        ) prior
        JOIN maps m ON m.id = l.map_id
        JOIN players p ON p.steamid64 = l.player_steamid64
        LEFT JOIN LATERAL (
            SELECT 1 + count(*) AS placement FROM (
                SELECT 1 FROM runs e
                WHERE e.map_id = l.map_id AND e.style = l.style AND e.track = l.track
                  AND e.invalidated_at IS NULL AND (e.finished_at, e.id) < (l.finished_at, l.id)
                  AND e.player_steamid64 <> l.player_steamid64
                GROUP BY e.player_steamid64
                HAVING min(e.time) < l.time
            ) faster
        ) place ON NOT EXISTS (
            SELECT 1 FROM runs e
            WHERE e.map_id = l.map_id AND e.style = l.style AND e.track = l.track
              AND e.invalidated_at IS NULL AND (e.finished_at, e.id) < (l.finished_at, l.id)
              AND e.player_steamid64 = l.player_steamid64 AND e.time <= l.time
        )
        ORDER BY l.finished_at DESC, l.id DESC
        "#,
        query.style,
        track,
        query.min_tier,
        query.records.unwrap_or(false),
        after.map(|(finished_at, _)| finished_at),
        after.map(|(_, run_id)| run_id),
        tiers_in_force,
        limit
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            RecentRun {
                run_id: row.id,
                player: PlayerRef {
                    steamid64: row.steamid64,
                    name: row.name,
                    avatar_url: row.avatar_url,
                    country_code: row.country_code,
                },
                map: row.map,
                style: row.style,
                track: row.track,
                tier: row.tier,
                time: row.time,
                finished_at: row.finished_at,
                placement: row.placement,
                world_record: row.was_record,
                // Rounded to the millisecond, as in WR history.
                gap: row
                    .best
                    .map(|best| ((row.time - best) * 1000.0).round() / 1000.0),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::RecentRuns;
    use crate::{
        maps::MapName,
        policies::{Policy, TiersPolicy},
        runs::tests::{run, setup},
        staff, test_client,
    };

    /// A run by `player` ("gabe" or "ricochet") on `map` and `track`, finishing `at` seconds after the first.
    fn run_by(id: &str, player: &str, map: &str, track: i16, time: f64, at: i64) -> Value {
        let mut body = run(id, time);
        if player == "ricochet" {
            body["player"] = json!({ "steamid64": "76561197960287931", "name": "ricochet" });
        }
        body["map"] = json!(map);
        body["track"] = json!(track);
        body["finished_at"] = json!(1_792_400_000 + at);
        body
    }

    /// (player, map, track, time, placement, world record) per run.
    async fn list(db: &PgPool, query: &str) -> Vec<(String, String, i16, f64, Option<i64>, bool)> {
        let page: RecentRuns = test_client::get(db, &format!("/v1/runs{query}"))
            .await
            .json();
        page.runs
            .into_iter()
            .map(|r| {
                (
                    r.player.name,
                    r.map,
                    r.track,
                    r.time,
                    r.placement,
                    r.world_record,
                )
            })
            .collect()
    }

    fn row(
        player: &str,
        map: &str,
        track: i16,
        time: f64,
        placement: Option<i64>,
        wr: bool,
    ) -> (String, String, i16, f64, Option<i64>, bool) {
        (
            player.to_owned(),
            map.to_owned(),
            track,
            time,
            placement,
            wr,
        )
    }

    #[sqlx::test]
    async fn lists_runs_newest_first_with_their_placement_when_set(db: PgPool) {
        let key = setup(&db).await;
        for body in [
            run_by("a", "gabe", "bhop_badges", 0, 30.0, 0),
            run_by("b", "ricochet", "bhop_badges", 0, 33.0, 10),
            run_by("c", "ricochet", "bhop_badges", 0, 28.0, 20),
            run_by("d", "gabe", "bhop_badges", 0, 31.0, 30),
            run_by("e", "gabe", "bhop_arcane", 1, 9.0, 40),
        ] {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), &body)
                    .await
                    .status,
                201
            );
        }

        // gabe's 31.0 didn't beat their own 30.0, so it never placed.
        assert_eq!(
            list(&db, "").await,
            [
                row("gabe", "bhop_arcane", 1, 9.0, Some(1), true),
                row("gabe", "bhop_badges", 0, 31.0, None, false),
                row("ricochet", "bhop_badges", 0, 28.0, Some(1), true),
                row("ricochet", "bhop_badges", 0, 33.0, Some(2), false),
                row("gabe", "bhop_badges", 0, 30.0, Some(1), true),
            ]
        );
        // Each run against the record when it finished.
        let main: RecentRuns = test_client::get(&db, "/v1/runs?track=main").await.json();
        let gaps: Vec<_> = main.runs.iter().map(|r| (r.time, r.gap)).collect();
        assert_eq!(
            gaps,
            [
                (31.0, Some(3.0)),
                (28.0, Some(-2.0)),
                (33.0, Some(3.0)),
                (30.0, None)
            ]
        );
        let records = list(&db, "?records=true&track=main").await;
        assert_eq!(records.len(), 2);
        assert_eq!(list(&db, "?track=bonus").await.len(), 1);
        assert_eq!(list(&db, "?style=sw").await.len(), 0);

        // Pages continue where the last one ended.
        let first: RecentRuns = test_client::get(&db, "/v1/runs?limit=2").await.json();
        let cursor = first.next_cursor.unwrap();
        let rest = list(&db, &format!("?limit=2&cursor={cursor}")).await;
        assert_eq!(
            rest[0],
            row("ricochet", "bhop_badges", 0, 28.0, Some(1), true)
        );
        assert_eq!(test_client::get(&db, "/v1/runs?cursor=x").await.status, 422);
        assert_eq!(test_client::get(&db, "/v1/runs?limit=0").await.status, 422);

        // An invalidated record leaves the list, and the record it had beaten is the board's best again.
        let run_id: i64 = sqlx::query_scalar("SELECT id FROM runs WHERE server_run_id = 'c'")
            .fetch_one(&db)
            .await
            .unwrap();
        staff::runs::invalidate_run(&db, None, run_id, None)
            .await
            .unwrap();
        assert_eq!(
            list(&db, "?track=main").await,
            [
                row("gabe", "bhop_badges", 0, 31.0, None, false),
                row("ricochet", "bhop_badges", 0, 33.0, Some(2), false),
                row("gabe", "bhop_badges", 0, 30.0, Some(1), true),
            ]
        );
    }

    #[sqlx::test]
    async fn a_lowest_tier_needs_tiers_in_force(db: PgPool) {
        let key = setup(&db).await;
        for body in [
            run_by("a", "gabe", "bhop_badges", 0, 30.0, 0),
            run_by("b", "gabe", "bhop_arcane", 0, 20.0, 10),
        ] {
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }
        assert_eq!(list(&db, "?min_tier=1").await.len(), 0);
        assert_eq!(
            test_client::get(&db, "/v1/runs?min_tier=0").await.status,
            422
        );

        staff::policies::publish_policy(
            &db,
            None,
            None,
            &Policy::Tiers(TiersPolicy { count: 5 }),
            None,
        )
        .await
        .unwrap();
        for (map, tier) in [("bhop_badges", 3), ("bhop_arcane", 1)] {
            let map = MapName::try_from(map.to_owned()).unwrap();
            staff::maps::set_tier(&db, None, &map, 0, tier)
                .await
                .unwrap();
        }
        let page: RecentRuns = test_client::get(&db, "/v1/runs?min_tier=2").await.json();
        assert_eq!(page.tier_count, Some(5));
        let shown: Vec<_> = page.runs.iter().map(|r| (r.map.as_str(), r.tier)).collect();
        assert_eq!(shown, [("bhop_badges", Some(3))]);
    }
}
