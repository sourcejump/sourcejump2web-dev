//! Stored points and totals: `personal_bests.points`, `standings`, `legacy_standings` and `maps.players`,
//! recounted where they change so the leaderboards and the map list only read them.
//!
//! What changes them, and who calls what here:
//! - a personal best set or removed (the ingest, run invalidation): `refresh_runs`, for those runs' boards.
//!   A new world record moves the speed points of everyone on its board, so a whole board's points are
//!   recounted, and the totals of the players whose points changed move by that change; and those maps'
//!   player counts;
//! - a track's tier (`staff/maps.rs`): `refresh_track`;
//! - the points or tiers policy (`staff/policies.rs`), or a new draft or formula in code: `refresh_all`, at
//!   publishing or at startup (`refresh_if_stale`);
//! - a ban or lifted ban, or a legacy import: `refresh_legacy`, as banned players' legacy runs don't count.
//!   A timed ban ends on its date with nothing written, so `watch_ended_bans` looks for those.
//!
//! Every recount takes one advisory lock and recounts from what's committed, so two at once can't leave
//! totals that miss each other's personal bests. Recounts are small (a track's boards, the players on them),
//! and the lock is held to the end of the caller's transaction.
//!
//! Lock order, the same everywhere so nothing deadlocks: a map's row, then personal bests, then this lock.
//! The ingest and invalidation lock the map and write personal bests before they recount, so a tier change
//! locks its map and then the `personal_bests` table before it recounts, and a full recount locks the whole
//! table first.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, types::Json as JsonColumn};
use utoipa::ToSchema;

use crate::{
    maps::tiers,
    players::restrictions::Restriction,
    policies::{PointsPolicy, Policy},
};

/// The advisory lock every recount holds: "standings" in ASCII.
const LOCK: i64 = 0x7374_616e_6469_6e67;
/// How often `watch_ended_bans` looks. Looking costs a few index reads per records ban ever given.
const ENDED_BANS_INTERVAL: Duration = Duration::from_mins(5);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PointsFormula {
    #[serde(flatten)]
    pub policy: PointsPolicy,
    /// True while the community hasn't published a formula and the draft is used.
    pub draft: bool,
    /// False until a tier count is published; 2.0 tracks without a tier earn no points.
    pub tiers: bool,
}

/// The published points policy, or the draft while there's none.
pub async fn formula(conn: &mut PgConnection) -> Result<PointsFormula, sqlx::Error> {
    let published = sqlx::query_scalar!(
        "SELECT value FROM policies WHERE name = 'points' ORDER BY version DESC LIMIT 1"
    )
    .fetch_optional(&mut *conn)
    .await?;
    let published = published.and_then(|value| match Policy::from_row("points", &value) {
        Some(Policy::Points(policy)) => Some(policy),
        _ => None,
    });
    Ok(PointsFormula {
        policy: published.unwrap_or(PointsPolicy::DRAFT),
        draft: published.is_none(),
        tiers: tiers::tier_count(conn).await?.is_some(),
    })
}

/// After personal bests changed on these runs' boards: recounts their maps' player counts, then those boards.
///
/// The player counts are recounted only here: a tier or policy change moves points, not who has a personal
/// best, and `refresh_all` locks every personal best before any map row, so recounting maps there would break
/// the lock order. They're recounted before this module's lock is taken: the callers' map row locks are what
/// keep them right, and every ingest waits on this lock.
pub async fn refresh_runs(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    crate::maps::count_players(conn, run_ids).await?;
    let boards = sqlx::query_as!(
        Board,
        "SELECT DISTINCT map_id, style, track FROM runs WHERE id = ANY($1)",
        run_ids
    )
    .fetch_all(&mut *conn)
    .await?;
    refresh(conn, &boards, run_ids).await
}

/// After a track's tier changed: recounts its board in every style.
pub async fn refresh_track(
    conn: &mut PgConnection,
    map_id: i64,
    track: i16,
) -> Result<(), sqlx::Error> {
    sqlx::query!("SELECT id FROM maps WHERE id = $1 FOR UPDATE", map_id)
        .fetch_optional(&mut *conn)
        .await?;
    // The lock the recount's writes take anyway, taken now to keep the lock order: a full recount locks the
    // whole table before this module's lock, so taking it after would deadlock with one.
    sqlx::query!("LOCK TABLE personal_bests IN ROW EXCLUSIVE MODE")
        .execute(&mut *conn)
        .await?;
    // The map row lock holds back new personal bests on it, so this list stays whole.
    let boards = sqlx::query_as!(
        Board,
        r#"SELECT DISTINCT map_id AS "map_id!", style AS "style!", track AS "track!" FROM personal_bests
           WHERE map_id = $1 AND track = $2"#,
        map_id,
        track
    )
    .fetch_all(&mut *conn)
    .await?;
    refresh(conn, &boards, &[]).await
}

/// One leaderboard: a map's track in one style.
struct Board {
    map_id: i64,
    style: String,
    track: i16,
}

/// Recounts these boards' points, and the totals they move: those of the players whose points changed, and of
/// `run_ids`' players, who may have a new personal best there or have just lost one.
///
/// A player's total moves by exactly the change in their points on these boards, so it's adjusted by that
/// rather than summed again from all their personal bests. That matters on a new world record, which moves
/// the points of everyone on its board: summing again read every personal best of every one of them (10 s on
/// a 30k-player board at 10× the legacy data, 2026-11-06). The runs' players are summed again, as their
/// completed count may have changed too and they may have no row yet. Adjusted totals can differ from a fresh
/// sum in the last digits; a full recount (`refresh_all`) sums them again.
async fn refresh(
    conn: &mut PgConnection,
    boards: &[Board],
    run_ids: &[i64],
) -> Result<(), sqlx::Error> {
    let map_ids: Vec<i64> = boards.iter().map(|board| board.map_id).collect();
    let styles: Vec<String> = boards.iter().map(|board| board.style.clone()).collect();
    let tracks: Vec<i16> = boards.iter().map(|board| board.track).collect();
    lock(conn).await?;
    let formula = formula(conn).await?;
    let p = formula.policy;
    sqlx::query!(
        r#"
        WITH boards AS (
            SELECT * FROM unnest($1::int8[], $2::text[], $3::int2[]) AS b (map_id, style, track)
        ), tiers AS (
            SELECT DISTINCT ON (map_id, track) map_id, track, tier FROM map_tiers
            WHERE $5 AND (map_id, track) IN (SELECT map_id, track FROM boards)
            ORDER BY map_id, track, assigned_at DESC
        ), scored AS (
            SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track,
                   coalesce(points_for(t.tier, pb.time,
                                       min(pb.time) OVER (PARTITION BY pb.map_id, pb.style, pb.track),
                                       pb.track > 0, $6, $7, $8, $9, $10), 0) AS points
            FROM boards b
            JOIN personal_bests pb ON pb.map_id = b.map_id AND pb.style = b.style AND pb.track = b.track
            LEFT JOIN tiers t ON t.map_id = pb.map_id AND t.track = pb.track
        ), changed AS (
            UPDATE personal_bests pb SET points = scored.points FROM scored
            WHERE pb.player_steamid64 = scored.player_steamid64 AND pb.map_id = scored.map_id
              AND pb.style = scored.style AND pb.track = scored.track AND pb.points <> scored.points
            RETURNING pb.style, pb.track > 0 AS bonus, pb.player_steamid64, new.points - old.points AS change
        ), moved AS (
            SELECT style, bonus, player_steamid64, sum(change) AS change FROM changed GROUP BY 1, 2, 3
        )
        UPDATE standings s SET points = s.points + m.change FROM moved m
        WHERE s.style = m.style AND s.bonus = m.bonus AND s.player_steamid64 = m.player_steamid64
          AND NOT EXISTS (
              SELECT 1 FROM runs r WHERE r.id = ANY($4) AND r.player_steamid64 = m.player_steamid64
                 AND r.style = m.style AND (r.track > 0) = m.bonus
          )
        "#,
        &map_ids,
        &styles,
        &tracks,
        run_ids,
        formula.tiers,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
    )
    .execute(&mut *conn)
    .await?;

    // The runs' players, summed again. Delete-then-insert under the lock: a player who no longer has a personal
    // best there loses their row.
    sqlx::query!(
        r#"
        DELETE FROM standings s USING runs r
        WHERE r.id = ANY($1)
          AND s.style = r.style AND s.bonus = (r.track > 0) AND s.player_steamid64 = r.player_steamid64
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"
        WITH affected AS (SELECT DISTINCT style, track > 0 AS bonus, player_steamid64 FROM runs WHERE id = ANY($1))
        INSERT INTO standings (style, bonus, player_steamid64, points, completed)
        SELECT a.style, a.bonus, a.player_steamid64, totals.points, totals.completed
        FROM affected a
        -- Each player's own personal bests, through the primary key: joined on the list instead, the planner
        -- can't tell how short it is and reads every personal best.
        CROSS JOIN LATERAL (
            SELECT sum(pb.points) AS points, count(*) AS completed FROM personal_bests pb
            WHERE pb.player_steamid64 = a.player_steamid64 AND pb.style = a.style AND (pb.track > 0) = a.bonus
        ) totals
        WHERE totals.completed > 0
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Recounts everything, 2.0 and legacy, with the formula in force, and records that formula.
pub async fn refresh_all(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    // Waits for runs being stored to commit and holds new ones back; reads go on.
    crate::query_time_limit::lift(conn).await?;
    sqlx::query!("LOCK TABLE personal_bests IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *conn)
        .await?;
    lock(conn).await?;
    let formula = formula(conn).await?;
    let p = formula.policy;
    sqlx::query!(
        r#"
        WITH tiers AS (
            SELECT DISTINCT ON (map_id, track) map_id, track, tier FROM map_tiers
            WHERE $1 ORDER BY map_id, track, assigned_at DESC
        ), scored AS (
            SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track,
                   coalesce(points_for(t.tier, pb.time,
                                       min(pb.time) OVER (PARTITION BY pb.map_id, pb.style, pb.track),
                                       pb.track > 0, $2, $3, $4, $5, $6), 0) AS points
            FROM personal_bests pb
            LEFT JOIN tiers t ON t.map_id = pb.map_id AND t.track = pb.track
        )
        UPDATE personal_bests pb SET points = scored.points FROM scored
        WHERE pb.player_steamid64 = scored.player_steamid64 AND pb.map_id = scored.map_id
          AND pb.style = scored.style AND pb.track = scored.track AND pb.points <> scored.points
        "#,
        formula.tiers,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!("DELETE FROM standings")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO standings (style, bonus, player_steamid64, points, completed)
        SELECT style, track > 0, player_steamid64, sum(points), count(*)
        FROM personal_bests GROUP BY style, track > 0, player_steamid64
        "#
    )
    .execute(&mut *conn)
    .await?;
    count_legacy(conn, &formula).await?;
    sqlx::query!(
        r#"
        INSERT INTO standings_formula (formula) VALUES ($1)
        ON CONFLICT (singleton) DO UPDATE SET formula = excluded.formula
        "#,
        JsonColumn(&formula) as _
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// After a ban, a lifted ban or a legacy import: recounts the legacy standings.
pub async fn refresh_legacy(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    lock(conn).await?;
    let formula = formula(conn).await?;
    count_legacy(conn, &formula).await
}

/// Runs for as long as the API does, starting with a look at startup, which also finds bans that ended while
/// it was down.
pub async fn watch_ended_bans(db: PgPool) {
    let mut ticks = tokio::time::interval(ENDED_BANS_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        match refresh_legacy_if_bans_ended(&db).await {
            Ok(true) => tracing::info!("recounted legacy standings after a records ban ended"),
            Ok(false) => {}
            Err(error) => {
                tracing::error!(%error, "looking for ended bans failed; trying again later");
            }
        }
    }
}

/// Recounts the legacy standings if they're missing a player with legacy runs whose records ban is over: one
/// that ended on its date since they were counted. Lifting a ban recounts by itself, so this finds only those.
pub async fn refresh_legacy_if_bans_ended(db: &PgPool) -> Result<bool, sqlx::Error> {
    // Looked for outside the lock, which ingest waits on; the recount reads what's committed under it.
    let stale = sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM bans b
               WHERE b.restrictions & $1 <> 0
                 AND NOT EXISTS (SELECT 1 FROM records_bans r WHERE r.player_steamid64 = b.player_steamid64)
                 AND NOT EXISTS (SELECT 1 FROM legacy_standings s WHERE s.player_steamid64 = b.player_steamid64)
                 AND EXISTS (SELECT 1 FROM legacy_runs l WHERE l.player_steamid64 = b.player_steamid64)
           ) AS "stale!""#,
        Restriction::NoRecords.bit()
    )
    .fetch_one(db)
    .await?;
    if stale {
        let mut tx = db.begin().await?;
        refresh_legacy(&mut tx).await?;
        tx.commit().await?;
    }
    Ok(stale)
}

/// At startup: recounts everything if the formula in force isn't the one the stored points were counted with,
/// as after this table's migration or a new draft in code.
pub async fn refresh_if_stale(db: &PgPool) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let counted = sqlx::query_scalar!("SELECT formula FROM standings_formula")
        .fetch_optional(&mut *tx)
        .await?;
    let in_force = formula(&mut tx).await?;
    let current = counted
        .and_then(|counted| serde_json::from_value::<PointsFormula>(counted).ok())
        .is_some_and(|counted| counted == in_force);
    if current {
        return Ok(false);
    }
    refresh_all(&mut tx).await?;
    tx.commit().await?;
    Ok(true)
}

/// Legacy records are one style's main tracks, on the old site's tiers, which are always in force for them.
async fn count_legacy(conn: &mut PgConnection, formula: &PointsFormula) -> Result<(), sqlx::Error> {
    let p = formula.policy;
    sqlx::query!("DELETE FROM legacy_standings")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO legacy_standings (player_steamid64, points, completed)
        SELECT player_steamid64, sum(points), count(*) FROM (
            SELECT l.player_steamid64,
                   coalesce(points_for(m.tier, l.time, min(l.time) OVER (PARTITION BY l.map_id), false,
                                       $1, $2, $3, $4, $5), 0) AS points
            FROM legacy_personal_bests l
            JOIN legacy_maps m ON m.id = l.map_id
            WHERE NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
        ) scored
        GROUP BY player_steamid64
        "#,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn lock(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    // A full recount takes seconds on real data, and waiting for another recount takes as long as that one.
    crate::query_time_limit::lift(conn).await?;
    sqlx::query!("SELECT pg_advisory_xact_lock($1)", LOCK)
        .execute(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::time::Duration;

    use sqlx::PgPool;

    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    /// Fails if a stored total differs from a fresh sum of the player's personal bests, beyond the last digits
    /// that adjusting by changes can leave.
    pub(crate) async fn assert_totals_current(db: &PgPool) {
        let drifted: Vec<(i64, f64, f64)> = sqlx::query_as(
            "WITH fresh AS (
                 SELECT style, track > 0 AS bonus, player_steamid64, sum(points) AS points, count(*) AS completed
                 FROM personal_bests GROUP BY 1, 2, 3
             )
             SELECT coalesce(f.player_steamid64, s.player_steamid64), coalesce(s.points, -1), coalesce(f.points, -1)
             FROM fresh f FULL JOIN standings s USING (style, bonus, player_steamid64)
             WHERE s.points IS NULL OR f.points IS NULL OR s.completed <> f.completed
                OR abs(s.points - f.points) > 1e-6",
        )
        .fetch_all(db)
        .await
        .unwrap();
        assert!(drifted.is_empty(), "stored totals drifted: {drifted:?}");
    }

    /// The ingest writes a personal best, then recounts. A full recount started in between used to take the
    /// standings lock and wait for that personal best, while the ingest waited for the lock: a deadlock.
    #[sqlx::test]
    async fn a_full_recount_waits_for_a_run_being_stored(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let run_id: i64 = sqlx::query_scalar("SELECT run_id FROM personal_bests")
            .fetch_one(&db)
            .await
            .unwrap();

        // Points the full recount has to correct, so it needs the row the ingest is about to lock.
        sqlx::query("UPDATE personal_bests SET points = 123")
            .execute(&db)
            .await
            .unwrap();
        // As the ingest does: the personal best's row first, the recount after.
        let mut ingest = db.begin().await.unwrap();
        sqlx::query("UPDATE personal_bests SET time = 29.0")
            .execute(&mut *ingest)
            .await
            .unwrap();
        let full = tokio::spawn({
            let db = db.clone();
            async move {
                let mut tx = db.begin().await?;
                super::refresh_all(&mut tx).await?;
                tx.commit().await
            }
        });
        tokio::time::sleep(Duration::from_millis(300)).await;
        super::refresh_runs(&mut ingest, &[run_id]).await.unwrap();
        ingest.commit().await.unwrap();
        full.await.unwrap().unwrap();
    }

    /// A tier change waiting for the standings lock, then a full recount behind it. The tier change used to
    /// touch personal bests only once it had the lock, after the full recount had locked the table: a deadlock.
    #[sqlx::test]
    async fn a_full_recount_waits_for_a_tier_change(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let map_id: i64 = sqlx::query_scalar("SELECT id FROM maps")
            .fetch_one(&db)
            .await
            .unwrap();

        // Another recount holds the lock, as a legacy recount would, so both queue behind it in this order.
        let mut holder = db.begin().await.unwrap();
        super::lock(&mut holder).await.unwrap();
        let tier = tokio::spawn({
            let db = db.clone();
            async move {
                let mut tx = db.begin().await?;
                super::refresh_track(&mut tx, map_id, 0).await?;
                tx.commit().await
            }
        });
        tokio::time::sleep(Duration::from_millis(300)).await;
        let full = tokio::spawn({
            let db = db.clone();
            async move {
                let mut tx = db.begin().await?;
                super::refresh_all(&mut tx).await?;
                tx.commit().await
            }
        });
        tokio::time::sleep(Duration::from_millis(300)).await;
        holder.commit().await.unwrap();
        tier.await.unwrap().unwrap();
        full.await.unwrap().unwrap();
    }
}
