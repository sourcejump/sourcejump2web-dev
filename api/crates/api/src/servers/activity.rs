//! `GET /v1/servers/activity`: players and servers online over time, across listed servers, for the chart on
//! the Servers page. Up to a month is built from `server_heartbeat_log`, which keeps 30 days; a year from
//! `server_activity_daily` and `server_activity_peaks`.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use sqlx::PgPool;

use crate::{app::AppState, error::ApiError};

/// A listed server counts as online at a moment if it beat within this long before it: the heartbeat interval
/// plus five minutes of grace, so a late or missed beat doesn't drop it from the count. Also used where
/// heartbeats keep `server_activity_peaks`, and written out in its migration (0053).
pub const ONLINE_WINDOW_MINUTES: i32 = 15;
/// How often "online at once" is sampled for a peak up to a month. Half the heartbeat interval, so every
/// regular beat is seen at least once; month (30 days) is 8640 samples, each one short index range scan. The
/// grid is anchored like the buckets, so a shorter range's samples are a subset of a longer range's, and its
/// `peak_players` can never exceed a longer one's.
const SAMPLE_MINUTES: i32 = 5;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActivityRange {
    Day,
    Week,
    Month,
    Year,
}

impl ActivityRange {
    /// Bucket length in minutes, and how many buckets. Two heartbeats per server per bucket at least, so a
    /// missed one doesn't read as a server going offline. A year is one point per UTC day.
    fn buckets(self) -> (i32, i32) {
        match self {
            Self::Day => (20, 72),
            Self::Week => (120, 84),
            Self::Month => (480, 90),
            Self::Year => (1440, 365),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ActivityQuery {
    /// `day` (the default), `week`, `month` or `year`.
    range: Option<ActivityRange>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ServerActivity {
    pub range: ActivityRange,
    pub bucket_minutes: i32,
    /// The most players online at once across listed servers over the whole range, from the start of its
    /// first point up to now, the bucket in progress included: no point reads higher, and a shorter range never
    /// reads higher than a longer one.
    pub peak_players: i32,
    /// Oldest first, one per bucket, empty buckets included. The bucket still in progress is left out, so the
    /// last point isn't a partial count.
    pub points: Vec<ActivityPoint>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ActivityPoint {
    /// Where the bucket starts.
    pub at: DateTime<Utc>,
    /// Listed servers heard from during the bucket.
    pub servers: i32,
    /// The average player count of each of those servers during the bucket, summed.
    pub players: i32,
    /// The most players online at once during the bucket, across listed servers: each server's latest
    /// heartbeat count, summed at the same moment. Up to a month, sampled every 5 minutes; for a year, the
    /// day's highest total at any heartbeat.
    pub peak_players: i32,
}

/// Players and servers online over the last day, week, month or year.
#[utoipa::path(
    get,
    path = "/v1/servers/activity",
    tag = "servers",
    params(ActivityQuery),
    responses((status = OK, body = ServerActivity)),
)]
pub async fn server_activity(
    State(state): State<AppState>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<ServerActivity>, ApiError> {
    let range = query.range.unwrap_or(ActivityRange::Day);
    let (bucket_minutes, count) = range.buckets();
    let (points, peak_players) = if let ActivityRange::Year = range {
        let (points, peak) = by_day(&state.db, count).await?;
        // The daily peaks are kept at every beat and the month at 5-minute samples, so either can read higher
        // (a spike between samples, or a server since unlisted); taking both keeps the year at least the month.
        let (month_minutes, month_count) = ActivityRange::Month.buckets();
        let (_, month_peak) = by_bucket(&state.db, month_minutes, month_count).await?;
        (points, peak.max(month_peak))
    } else {
        by_bucket(&state.db, bucket_minutes, count).await?
    };
    Ok(Json(ServerActivity {
        range,
        bucket_minutes,
        peak_players,
        points,
    }))
}

/// Buckets of `minutes` from the heartbeat log, and the range's peak: samples run on through the bucket in
/// progress to the latest whole sample moment, and the peak takes those from `count` buckets' length ago.
async fn by_bucket(
    db: &PgPool,
    minutes: i32,
    count: i32,
) -> Result<(Vec<ActivityPoint>, i32), sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        WITH bounds AS (
            SELECT make_interval(mins => $1) AS bucket,
                   date_bin(make_interval(mins => $1), now(), TIMESTAMPTZ '2000-01-01') AS current,
                   date_bin(make_interval(mins => $3), now(), TIMESTAMPTZ '2000-01-01') AS latest
        ), buckets AS (
            SELECT generate_series(current - $2 * bucket, current - bucket, bucket) AS at FROM bounds
        ), per_server AS (
            SELECT date_bin(bounds.bucket, h.received_at, TIMESTAMPTZ '2000-01-01') AS at,
                   h.ip, h.port, avg(h.players) AS players
            FROM server_heartbeat_log h
            CROSS JOIN bounds
            JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
            WHERE h.received_at >= bounds.current - $2 * bounds.bucket AND h.received_at < bounds.current
            GROUP BY 1, 2, 3
        ), online AS (
            SELECT m.at, sum(latest.players) AS players
            FROM bounds
            CROSS JOIN generate_series(
                bounds.current - $2 * bounds.bucket,
                bounds.latest,
                make_interval(mins => $3)
            ) AS m(at)
            CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h.ip, h.port) h.players
                FROM server_heartbeat_log h
                JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
                WHERE h.received_at > m.at - make_interval(mins => $4) AND h.received_at <= m.at
                ORDER BY h.ip, h.port, h.received_at DESC
            ) latest
            GROUP BY m.at
        ), peaks AS (
            SELECT date_bin(bounds.bucket, online.at, TIMESTAMPTZ '2000-01-01') AS at, max(online.players) AS players
            FROM online CROSS JOIN bounds
            GROUP BY 1
        ), whole AS (
            SELECT coalesce(max(online.players), 0)::int AS players
            FROM online CROSS JOIN bounds
            WHERE online.at >= bounds.current - $2 * bounds.bucket
        )
        SELECT b.at AS "at!", count(p.ip)::int AS "servers!", coalesce(round(sum(p.players)), 0)::int AS "players!",
               coalesce(pk.players, 0)::int AS "peak_players!", whole.players AS "range_peak!"
        FROM buckets b
        CROSS JOIN whole
        LEFT JOIN per_server p ON p.at = b.at
        LEFT JOIN peaks pk ON pk.at = b.at
        GROUP BY b.at, pk.players, whole.players
        ORDER BY b.at
        "#,
        minutes,
        f64::from(count),
        SAMPLE_MINUTES,
        ONLINE_WINDOW_MINUTES
    )
    .fetch_all(db)
    .await?;
    let peak = rows.first().map_or(0, |r| r.range_peak);
    let points = rows
        .into_iter()
        .map(|r| ActivityPoint {
            at: r.at,
            servers: r.servers,
            players: r.players,
            peak_players: r.peak_players,
        })
        .collect();
    Ok((points, peak))
}

/// The last `count` whole UTC days from the daily totals and peaks; today is still in progress, so it's left
/// out. And the highest daily peak from the first of those days through today, so the range's peak is never
/// below a day the chart shows, nor misses today.
async fn by_day(db: &PgPool, count: i32) -> Result<(Vec<ActivityPoint>, i32), sqlx::Error> {
    let peak = sqlx::query_scalar!(
        r#"SELECT coalesce(max(players), 0) AS "players!" FROM server_activity_peaks
           WHERE day >= (now() AT TIME ZONE 'UTC')::date - $1::int"#,
        count
    )
    .fetch_one(db)
    .await?;
    let points = sqlx::query_as!(
        ActivityPoint,
        r#"
        WITH days AS (
            SELECT generate_series((today - $1::int)::timestamp, (today - 1)::timestamp, interval '1 day')::date AS day
            FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t
        )
        SELECT days.day::timestamp AT TIME ZONE 'UTC' AS "at!",
               count(d.ip)::int AS "servers!",
               coalesce(round(sum(d.players_sum::float8 / d.heartbeats)), 0)::int AS "players!",
               coalesce(pk.players, 0) AS "peak_players!"
        FROM days
        LEFT JOIN server_activity_daily d ON d.day = days.day
            AND EXISTS (SELECT 1 FROM server_listings l WHERE l.ip = d.ip AND l.port = d.port)
        LEFT JOIN server_activity_peaks pk ON pk.day = days.day
        GROUP BY days.day, pk.players
        ORDER BY days.day
        "#,
        count
    )
    .fetch_all(db)
    .await?;
    Ok((points, peak))
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::ServerActivity;
    use crate::{
        servers::{
            heartbeat::tests::{beat, report},
            listing,
        },
        test_client,
    };

    #[sqlx::test]
    async fn counts_listed_servers_and_their_players_per_bucket(db: PgPool) {
        listing::list(&db, "203.0.113.1:27015".parse().unwrap(), None)
            .await
            .unwrap();
        listing::list(&db, "203.0.113.2:27015".parse().unwrap(), None)
            .await
            .unwrap();
        for ip in ["203.0.113.1", "203.0.113.2", "203.0.113.3"] {
            beat(&db, ip, None, &report(27015)).await;
        }
        // Only listed servers are logged; move their beats an hour back so they fall in a finished bucket.
        let mut more = report(27015);
        more["players"] = serde_json::json!(20);
        beat(&db, "203.0.113.1", None, &more).await;
        sqlx::query("UPDATE server_heartbeat_log SET received_at = date_bin('20 minutes', now(), '2000-01-01') - interval '50 minutes'")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("UPDATE server_heartbeat_log SET received_at = received_at + interval '1 minute' WHERE players = 20")
            .execute(&db)
            .await
            .unwrap();

        let activity: ServerActivity = test_client::get(&db, "/v1/servers/activity").await.json();

        assert_eq!(activity.bucket_minutes, 20);
        assert_eq!(activity.points.len(), 72);
        let busy: Vec<_> = activity
            .points
            .iter()
            .filter(|p| p.servers > 0)
            .map(|p| (p.servers, p.players, p.peak_players))
            .collect();
        // .1 averaged (12 + 20) / 2 = 16, .2 had 12; .3 isn't listed. At once: .1's latest 20, and .2's 12.
        assert_eq!(busy, [(2, 28, 32)]);
    }

    /// Lists the servers, then has each send a beat of `players` at `minutes` before the start of the
    /// current 8-hour bin: a finished bucket for the day, week and month, and within the last day.
    async fn beats_at(db: &PgPool, beats: &[(&str, i64, i64)]) {
        for (ip, players, minutes) in beats {
            listing::list(db, format!("{ip}:27015").parse().unwrap(), None)
                .await
                .unwrap();
            let mut body = report(27015);
            body["players"] = serde_json::json!(players);
            beat(db, ip, None, &body).await;
            sqlx::query(
                "UPDATE server_heartbeat_log SET received_at = date_bin('8 hours', now(), '2000-01-01') - make_interval(mins => $1::int)
                 WHERE received_at > now() - interval '1 minute'",
            )
            .bind(minutes)
            .execute(db)
            .await
            .unwrap();
        }
    }

    async fn activity(db: &PgPool, range: &str) -> ServerActivity {
        test_client::get(db, &format!("/v1/servers/activity?range={range}"))
            .await
            .json()
    }

    fn peak(activity: &ServerActivity) -> i32 {
        activity
            .points
            .iter()
            .map(|p| p.peak_players)
            .max()
            .unwrap()
    }

    #[sqlx::test]
    async fn the_peak_is_players_online_at_the_same_moment(db: PgPool) {
        // .1 has 10, then 2; .2 joins with 6 five minutes after .1's first beat, while .1 still counts.
        beats_at(
            &db,
            &[
                ("203.0.113.1", 10, 180),
                ("203.0.113.2", 6, 175),
                ("203.0.113.1", 2, 170),
            ],
        )
        .await;

        let day = activity(&db, "day").await;
        let busy: Vec<_> = day.points.iter().filter(|p| p.servers > 0).collect();
        // One 20-minute bucket: averages (10 + 2) / 2 + 6 = 12, but 10 + 6 were online at once.
        assert_eq!(busy.len(), 1);
        assert_eq!((busy[0].players, busy[0].peak_players), (12, 16));
    }

    #[sqlx::test]
    async fn a_spike_the_average_flattens_still_peaks_and_longer_ranges_keep_it(db: PgPool) {
        // One 2-hour bucket of beats every 10 minutes with 2 players, and one with 30 between them.
        let quiet: Vec<_> = (0..11).map(|i| ("203.0.113.1", 2, 119 - i * 10)).collect();
        beats_at(&db, &quiet).await;
        beats_at(&db, &[("203.0.113.1", 30, 64)]).await;

        let (day, week, month) = (
            activity(&db, "day").await,
            activity(&db, "week").await,
            activity(&db, "month").await,
        );
        assert_eq!(peak(&day), 30);
        // The 2-hour bucket's average is (11 × 2 + 30) / 12 = 4, but the spike is its peak.
        let bucket = week.points.iter().find(|p| p.servers > 0).unwrap();
        assert_eq!((bucket.players, bucket.peak_players), (4, 30));
        // Longer ranges sample the same moments and more, so they never peak lower.
        assert!(peak(&week) >= peak(&day) && peak(&month) >= peak(&day));
    }

    /// Has a listed server beat with `players` at the latest 5-minute moment: within every range's bucket in
    /// progress, and its last sample.
    async fn beat_now(db: &PgPool, ip: &str, players: i64) {
        listing::list(db, format!("{ip}:27015").parse().unwrap(), None)
            .await
            .unwrap();
        let mut body = report(27015);
        body["players"] = serde_json::json!(players);
        beat(db, ip, None, &body).await;
        sqlx::query(
            "UPDATE server_heartbeat_log SET received_at = date_bin('5 minutes', now(), '2000-01-01')
             WHERE received_at > now() - interval '1 minute'",
        )
        .execute(db)
        .await
        .unwrap();
    }

    #[sqlx::test]
    async fn the_range_peak_includes_the_bucket_in_progress(db: PgPool) {
        beats_at(&db, &[("203.0.113.1", 2, 60)]).await;
        beat_now(&db, "203.0.113.1", 30).await;

        let mut left_out = false;
        for range in ["day", "week", "month", "year"] {
            let activity = activity(&db, range).await;
            assert_eq!(activity.peak_players, 30, "{range}");
            left_out |= peak(&activity) < 30;
        }
        // The points leave the bucket in progress out, so they can't show the spike yet.
        assert!(left_out);
    }

    #[sqlx::test]
    async fn a_longer_range_never_peaks_lower(db: PgPool) {
        // 50 at once 20 days ago, 30 three days ago, 10 now; 70 on a day 100 days ago.
        beats_at(
            &db,
            &[
                ("203.0.113.1", 25, 20 * 1440),
                ("203.0.113.2", 25, 20 * 1440),
                ("203.0.113.1", 30, 3 * 1440),
            ],
        )
        .await;
        beat_now(&db, "203.0.113.2", 10).await;
        // Beats kept today's peak as sent, all at once; clear it to test the windows alone.
        sqlx::query("DELETE FROM server_activity_peaks")
            .execute(&db)
            .await
            .unwrap();
        let peaks = || async {
            let mut peaks = vec![];
            for range in ["day", "week", "month", "year"] {
                peaks.push(activity(&db, range).await.peak_players);
            }
            peaks
        };

        // With no daily peaks, a year is still at least the month.
        assert_eq!(peaks().await, [10, 30, 50, 50]);
        sqlx::query(
            "INSERT INTO server_activity_peaks (day, players) VALUES (current_date - 100, 70)",
        )
        .execute(&db)
        .await
        .unwrap();
        assert_eq!(peaks().await, [10, 30, 50, 70]);
    }

    #[sqlx::test]
    async fn heartbeats_keep_the_days_peak(db: PgPool) {
        listing::list(&db, "203.0.113.1:27015".parse().unwrap(), None)
            .await
            .unwrap();
        listing::list(&db, "203.0.113.2:27015".parse().unwrap(), None)
            .await
            .unwrap();
        let mut quiet = report(27015);
        quiet["players"] = serde_json::json!(4);
        beat(&db, "203.0.113.1", None, &report(27015)).await;
        beat(&db, "203.0.113.2", None, &report(27015)).await;
        beat(&db, "203.0.113.1", None, &quiet).await;
        // An unlisted server doesn't count.
        beat(&db, "203.0.113.3", None, &report(27015)).await;
        let today: i32 = sqlx::query_scalar("SELECT players FROM server_activity_peaks")
            .fetch_one(&db)
            .await
            .unwrap();
        // 12 + 12 at the second beat; .1 dropping to 4 doesn't lower the day's peak.
        assert_eq!(today, 24);
    }

    #[sqlx::test]
    async fn a_year_is_daily_averages(db: PgPool) {
        listing::list(&db, "203.0.113.1:27015".parse().unwrap(), None)
            .await
            .unwrap();
        let mut quiet = report(27015);
        quiet["players"] = serde_json::json!(4);
        beat(&db, "203.0.113.1", None, &report(27015)).await;
        beat(&db, "203.0.113.1", None, &quiet).await;
        beat(&db, "203.0.113.2", None, &report(27015)).await;
        // Today is left out of the year, so move today's totals to yesterday.
        for sql in [
            "UPDATE server_activity_daily SET day = day - 1",
            "UPDATE server_activity_peaks SET day = day - 1",
        ] {
            sqlx::query(sql).execute(&db).await.unwrap();
        }

        let year: ServerActivity = test_client::get(&db, "/v1/servers/activity?range=year")
            .await
            .json();

        assert_eq!((year.bucket_minutes, year.points.len()), (1440, 365));
        let last = year.points.last().unwrap();
        // (12 + 4) / 2 players on average, on the one listed server; at most 12 at once.
        assert_eq!((last.servers, last.players, last.peak_players), (1, 8, 12));
        assert!(
            year.points
                .iter()
                .rev()
                .skip(1)
                .all(|p| p.peak_players == 0)
        );
    }

    #[sqlx::test]
    async fn knows_its_ranges(db: PgPool) {
        let week: ServerActivity = test_client::get(&db, "/v1/servers/activity?range=week")
            .await
            .json();
        assert_eq!((week.bucket_minutes, week.points.len()), (120, 84));
        assert!(
            week.points
                .iter()
                .all(|p| p.servers == 0 && p.players == 0 && p.peak_players == 0)
        );
        let status = test_client::get(&db, "/v1/servers/activity?range=decade")
            .await
            .status;
        assert_eq!(status, 400);
    }
}
