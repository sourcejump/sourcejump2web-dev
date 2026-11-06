//! Site-wide totals per UTC day (`daily_totals`): players with a recorded time, and runs and world records
//! finished each day, for the charts on the Players and Activity pages.
//!
//! Counting these on every view would read every run, so a job keeps one row per day. Its first pass builds
//! the whole history from the runs; after that, each pass recounts yesterday and today, and from any earlier
//! day that a late, invalidated or restored run changed (`daily_totals_stale`, filled by a trigger on runs). A
//! day's player count is the last one taken that day, so a player whose runs are all invalidated later still
//! counts on the days they had a time. A legacy import rebuilds the history, since it changes who had a time when.

use std::time::Duration;

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{NaiveDate, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, error::ApiError};

/// How often the job recounts. The charts show days, so an hour behind is close enough.
const INTERVAL: Duration = Duration::from_hours(1);
/// The most points a chart gets. Longer spans are grouped into buckets of several days.
const MAX_POINTS: i64 = 365;

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(player_totals))
        .routes(routes!(run_totals))
}

/// Runs for as long as the API does, starting with a pass at startup.
pub async fn run(db: PgPool) {
    let mut ticks = tokio::time::interval(INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        if let Err(error) = refresh(&db).await {
            tracing::error!(%error, "daily totals job failed; trying again later");
        }
    }
}

/// Builds the history if there is none, or else recounts to today from the day before the newest row, or from
/// the earliest stale day if that's earlier.
pub async fn refresh(db: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let newest = sqlx::query_scalar!("SELECT max(day) FROM daily_totals")
        .fetch_one(&mut *tx)
        .await?;
    let Some(newest) = newest else {
        rebuild(&mut tx).await?;
        return tx.commit().await;
    };
    // Taken in the same transaction as the recount: a day marked after this is left for the next pass.
    let stale = sqlx::query_scalar!(
        "WITH taken AS (DELETE FROM daily_totals_stale RETURNING day) SELECT min(day) FROM taken"
    )
    .fetch_one(&mut *tx)
    .await?;
    // From the day before, so the last hour of a day that ended since the previous pass is counted too.
    let from = stale.map_or(newest - TimeDelta::days(1), |stale| {
        stale.min(newest - TimeDelta::days(1))
    });
    sqlx::query!(
        r#"
        WITH players AS (
            SELECT count(*)::integer AS count FROM (
                SELECT player_steamid64 FROM personal_bests
                UNION SELECT player_steamid64 FROM legacy_runs
            ) p
        ), days AS (
            SELECT d::date AS day
            FROM generate_series($1::date, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
        )
        INSERT INTO daily_totals AS t (day, players, runs, world_records)
        SELECT days.day, players.count, coalesce(r.runs, 0), coalesce(r.world_records, 0)
        FROM days CROSS JOIN players
        LEFT JOIN daily_run_totals($1::date::timestamp AT TIME ZONE 'UTC') r USING (day)
        ON CONFLICT (day) DO UPDATE SET
            runs = excluded.runs,
            world_records = excluded.world_records,
            -- A day that has ended keeps the count taken on it.
            players = CASE WHEN t.day = (now() AT TIME ZONE 'UTC')::date
                           THEN excluded.players ELSE t.players END
        "#,
        from
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Replaces the history with one counted from every run: each day's players are those whose first recorded
/// time is on or before it. Pre-2.0 players whose runs carry no readable date count from the first day.
pub async fn rebuild(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM daily_totals")
        .execute(&mut *conn)
        .await?;
    sqlx::query!("DELETE FROM daily_totals_stale")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        WITH firsts AS (
            -- NULL for a player with no readable date: LEAST would skip it and make it today.
            SELECT CASE WHEN min(first) IS NOT NULL
                        THEN (LEAST(min(first), now()) AT TIME ZONE 'UTC')::date END AS day FROM (
                SELECT player_steamid64, min(finished_at) AS first FROM runs
                WHERE invalidated_at IS NULL GROUP BY 1
                UNION ALL
                SELECT player_steamid64, min(finished_at) FROM legacy_runs GROUP BY 1
            ) f
            GROUP BY player_steamid64
        ), run_totals AS (
            SELECT * FROM daily_run_totals('-infinity')
        ), bounds AS (
            SELECT LEAST((SELECT min(day) FROM firsts), (SELECT min(day) FROM run_totals)) AS start
        ), joined AS (
            SELECT coalesce(firsts.day, bounds.start) AS day, count(*) AS count
            FROM firsts CROSS JOIN bounds GROUP BY 1
        ), days AS (
            SELECT d::date AS day
            FROM bounds, generate_series(bounds.start, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
        )
        INSERT INTO daily_totals (day, players, runs, world_records)
        SELECT days.day, (sum(coalesce(joined.count, 0)) OVER (ORDER BY days.day))::integer,
               coalesce(r.runs, 0), coalesce(r.world_records, 0)
        FROM days
        LEFT JOIN joined USING (day)
        LEFT JOIN run_totals r USING (day)
        "#
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TotalsRange {
    /// The last 30 days.
    Month,
    /// The last 365 days.
    Year,
    /// From the first day with data.
    All,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct TotalsQuery {
    /// `month` (the default), `year` or `all`.
    range: Option<TotalsRange>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerTotals {
    pub range: TotalsRange,
    /// Days per point: 1, or more when the range is too long for a point a day.
    pub bucket_days: i32,
    /// Oldest first, ending today.
    pub points: Vec<PlayerTotalsPoint>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerTotalsPoint {
    /// The first day the point covers.
    pub day: NaiveDate,
    /// Players with at least one recorded time, 2.0 or pre-2.0, at the end of the point's last day.
    pub players: i32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunTotals {
    pub range: TotalsRange,
    /// Days per point: 1, or more when the range is too long for a point a day.
    pub bucket_days: i32,
    /// Oldest first, ending yesterday: today is left out, so the last point isn't a partial count.
    pub points: Vec<RunTotalsPoint>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunTotalsPoint {
    /// The first day the point covers.
    pub day: NaiveDate,
    /// Valid 2.0 runs finished during the point's days, by the game server's clock.
    pub runs: i32,
    /// Of those, the runs that set a world record.
    pub world_records: i32,
}

/// Players with a recorded time over the last month or year, or ever.
#[utoipa::path(
    get,
    path = "/v1/daily-totals/players",
    tag = "daily-totals",
    params(TotalsQuery),
    responses((status = OK, body = PlayerTotals)),
)]
pub async fn player_totals(
    State(state): State<AppState>,
    Query(query): Query<TotalsQuery>,
) -> Result<Json<PlayerTotals>, ApiError> {
    let range = query.range.unwrap_or(TotalsRange::Month);
    let today = Utc::now().date_naive();
    let buckets = buckets(&state.db, range, today, false).await?;
    Ok(Json(PlayerTotals {
        range,
        bucket_days: buckets.days,
        points: buckets
            .days_in_each
            .into_iter()
            .map(|(day, rows)| PlayerTotalsPoint {
                day,
                // Before the history starts nobody had a time.
                players: rows.last().map_or(0, |row| row.players),
            })
            .collect(),
    }))
}

/// Runs and world records per day over the last month or year, or since the first run.
#[utoipa::path(
    get,
    path = "/v1/daily-totals/runs",
    tag = "daily-totals",
    params(TotalsQuery),
    responses((status = OK, body = RunTotals)),
)]
pub async fn run_totals(
    State(state): State<AppState>,
    Query(query): Query<TotalsQuery>,
) -> Result<Json<RunTotals>, ApiError> {
    let range = query.range.unwrap_or(TotalsRange::Month);
    let yesterday = Utc::now().date_naive() - TimeDelta::days(1);
    let buckets = buckets(&state.db, range, yesterday, true).await?;
    Ok(Json(RunTotals {
        range,
        bucket_days: buckets.days,
        points: buckets
            .days_in_each
            .into_iter()
            .map(|(day, rows)| RunTotalsPoint {
                day,
                runs: rows.iter().map(|row| row.runs).sum(),
                world_records: rows.iter().map(|row| row.world_records).sum(),
            })
            .collect(),
    }))
}

struct DayRow {
    day: NaiveDate,
    players: i32,
    runs: i32,
    world_records: i32,
}

struct Buckets {
    days: i32,
    /// Each bucket's first day, and its rows.
    days_in_each: Vec<(NaiveDate, Vec<DayRow>)>,
}

/// The range's rows, grouped into at most `MAX_POINTS` buckets of equal length that end on `end`, so the
/// newest point is a whole one; the oldest may start before the history does. `since_first_run` starts the
/// `all` range at the first run rather than at the first player, who may be years older.
async fn buckets(
    db: &PgPool,
    range: TotalsRange,
    end: NaiveDate,
    since_first_run: bool,
) -> Result<Buckets, sqlx::Error> {
    let first = match range {
        TotalsRange::Month => Some(end - TimeDelta::days(29)),
        TotalsRange::Year => Some(end - TimeDelta::days(364)),
        TotalsRange::All => {
            sqlx::query_scalar!(
                "SELECT min(day) FROM daily_totals WHERE NOT $1 OR runs > 0",
                since_first_run
            )
            .fetch_one(db)
            .await?
        }
    };
    let Some(first) = first.filter(|first| *first <= end) else {
        return Ok(Buckets {
            days: 1,
            days_in_each: Vec::new(),
        });
    };
    let span = (end - first).num_days() + 1;
    let days = (span + MAX_POINTS - 1) / MAX_POINTS;
    let count = (span + days - 1) / days;
    let start = end - TimeDelta::days(count * days - 1);

    let rows = sqlx::query_as!(
        DayRow,
        "SELECT day, players, runs, world_records FROM daily_totals WHERE day BETWEEN $1 AND $2 ORDER BY day",
        start,
        end
    )
    .fetch_all(db)
    .await?;
    let mut days_in_each: Vec<(NaiveDate, Vec<DayRow>)> = (0..count)
        .map(|i| (start + TimeDelta::days(i * days), Vec::new()))
        .collect();
    for row in rows {
        let index = (row.day - start).num_days() / days;
        if let Some((_, bucket)) = usize::try_from(index)
            .ok()
            .and_then(|i| days_in_each.get_mut(i))
        {
            bucket.push(row);
        }
    }
    Ok(Buckets {
        days: i32::try_from(days).unwrap_or(i32::MAX),
        days_in_each,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::{PlayerTotals, RunTotals, refresh};
    use crate::{
        runs::{
            RunAccepted,
            tests::{run, setup},
        },
        staff::runs::invalidate_run,
        test_client,
    };

    /// A run by `player` on `map`, finished `days_ago` days before now.
    fn run_by(id: &str, player: u64, map: &str, time: f64, days_ago: i64) -> Value {
        let mut body = run(id, time);
        body["player"] = json!({ "steamid64": player.to_string(), "name": format!("p{player}") });
        body["map"] = json!(map);
        body["finished_at"] = json!(chrono::Utc::now().timestamp() - days_ago * 86_400);
        body
    }

    #[sqlx::test]
    async fn counts_players_runs_and_records_per_day(db: PgPool) {
        let key = setup(&db).await;
        for body in [
            run_by("a", 76_561_197_960_287_930, "bhop_badges", 30.0, 3),
            run_by("b", 76_561_197_960_287_931, "bhop_badges", 33.0, 3),
            run_by("c", 76_561_197_960_287_931, "bhop_badges", 28.0, 2),
            run_by("d", 76_561_197_960_287_930, "bhop_arcane", 9.0, 1),
            run_by("e", 76_561_197_960_287_930, "bhop_arcane", 10.0, 1),
        ] {
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }
        sqlx::raw_sql(
            "INSERT INTO legacy_maps (id, name, points) VALUES (1, 'bhop_old', 0);
             INSERT INTO legacy_players (steamid64, name) VALUES (76561197960287999, 'old');
             INSERT INTO legacy_runs (id, map_id, player_steamid64, player_name, server_hostname, time, sync,
                                      strafes, jumps, finished_at, initial_record)
             VALUES (1, 1, 76561197960287999, 'old', 's', 20, 90, 1, 1, NULL, false);",
        )
        .execute(&db)
        .await
        .unwrap();
        refresh(&db).await.unwrap();

        let runs: RunTotals = test_client::get(&db, "/v1/daily-totals/runs").await.json();
        assert_eq!(runs.points.len(), 30);
        let last: Vec<_> = runs.points[27..]
            .iter()
            .map(|p| (p.runs, p.world_records))
            .collect();
        // A record is faster than every run before it on its board: the 33.0 and the 10.0 aren't.
        assert_eq!(last, [(2, 1), (1, 1), (2, 1)]);

        // The legacy player, with no readable date, counts from the first day.
        let players: PlayerTotals = test_client::get(&db, "/v1/daily-totals/players?range=all")
            .await
            .json();
        let counts: Vec<_> = players.points.iter().map(|p| p.players).collect();
        assert_eq!(counts, [3, 3, 3, 3]);

        // A later pass recounts recent days without dropping the history.
        test_client::post(
            &db,
            "/v1/runs",
            Some(&key),
            &run_by("f", 76_561_197_960_287_932, "bhop_badges", 27.0, 0),
        )
        .await;
        refresh(&db).await.unwrap();
        let players: PlayerTotals = test_client::get(&db, "/v1/daily-totals/players")
            .await
            .json();
        assert_eq!(players.points.last().map(|p| p.players), Some(4));
        assert_eq!(players.points[28].players, 3);
    }

    #[sqlx::test]
    async fn recounts_older_days_that_late_or_invalidated_runs_changed(db: PgPool) {
        let key = setup(&db).await;
        let submit = async |body: Value| -> i64 {
            let accepted: RunAccepted = test_client::post(&db, "/v1/runs", Some(&key), &body)
                .await
                .json();
            accepted.id
        };
        let record = submit(run_by("a", 76_561_197_960_287_930, "bhop_badges", 30.0, 3)).await;
        submit(run_by("b", 76_561_197_960_287_931, "bhop_badges", 33.0, 3)).await;
        refresh(&db).await.unwrap();
        // Points run oldest first, yesterday last: [25] is five days ago, [27] three.
        let days = async || -> Vec<(i32, i32)> {
            let runs: RunTotals = test_client::get(&db, "/v1/daily-totals/runs").await.json();
            runs.points[25..28]
                .iter()
                .map(|p| (p.runs, p.world_records))
                .collect()
        };
        assert_eq!(days().await, [(0, 0), (0, 0), (2, 1)]);

        // Arrives late, finished five days ago; then the 30.0 is invalidated, so the 33.0 is no record either.
        submit(run_by("c", 76_561_197_960_287_932, "bhop_badges", 31.0, 5)).await;
        invalidate_run(&db, None, record, Some("test"))
            .await
            .unwrap();
        refresh(&db).await.unwrap();
        assert_eq!(days().await, [(1, 1), (0, 0), (1, 0)]);
        let stale: i64 = sqlx::query_scalar("SELECT count(*) FROM daily_totals_stale")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(stale, 0, "taken by the pass");
    }
}
