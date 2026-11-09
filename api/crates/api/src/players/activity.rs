//! How many valid runs players finished on each UTC day, up to today: the 30-day strip on the Players page
//! (`list.rs`) and the year on a profile (`profile.rs`). One query for any number of players, read through
//! the `runs_player_latest` index, so a busy player costs one index range rather than all of their runs.

use std::collections::HashMap;

use chrono::Utc;
use sqlx::PgPool;

/// Each player's runs per day over the last `days` days, oldest first and today last. Every player asked
/// for has an entry, all zeros without runs in that time.
pub async fn runs_per_day(
    db: &PgPool,
    players: &[i64],
    days: i32,
) -> Result<HashMap<i64, Vec<i32>>, sqlx::Error> {
    let today = Utc::now().date_naive();
    let rows = sqlx::query!(
        r#"
        SELECT p.id AS "steamid64!", activity.days AS "days!"
        FROM unnest($1::bigint[]) p(id)
        CROSS JOIN LATERAL (
            SELECT array_agg(coalesce(counted.runs, 0) ORDER BY day) AS days
            FROM generate_series($2::date - ($3::int - 1), $2::date, interval '1 day') day
            LEFT JOIN (
                SELECT (r.finished_at AT TIME ZONE 'UTC')::date AS finished_on, count(*)::int AS runs
                FROM runs r
                WHERE r.player_steamid64 = p.id AND r.invalidated_at IS NULL
                  AND r.finished_at >= ($2::date - ($3::int - 1))::timestamp AT TIME ZONE 'UTC'
                GROUP BY 1
            ) counted ON counted.finished_on = day::date
        ) activity
        "#,
        players,
        today,
        days,
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.steamid64, row.days))
        .collect())
}
