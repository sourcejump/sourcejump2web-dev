//! Stored totals: `standings`, `legacy_standings` and `maps.players`, recounted where they change so the
//! leaderboards and the map list only read them.
//!
//! A personal best's points follow from its time and two values of its board: the best time and the tier.
//! Those are stored per board as the totals were counted with them (`standings_boards`), with the formula they
//! were counted with (`standings_formula`), and pages work a personal best's points out from them
//! (`personal_best_points`, migration 0051).
//!
//! What changes them, and who calls what here:
//! - a personal best set or removed (the ingest, run invalidation): `refresh_runs`, for those runs' boards, and
//!   those maps' player counts;
//! - a track's tier (`staff/maps.rs`): `refresh_track`;
//! - the points or tiers policy (`staff/policies.rs`), or a new draft or formula in code: `refresh_all`, at
//!   publishing, or in the background after startup (`refresh_if_stale`);
//! - a ban or lifted ban, or a legacy import: `refresh_legacy`, as banned players' legacy runs don't count.
//!   A timed ban ends on its date with nothing written, so `watch_ended_bans` looks for those.
//!
//! A board's recount compares its best time and tier with the stored ones. When they're the same, as after a
//! personal best that isn't a world record, only the runs' own players' totals change. When they differ, as
//! after a new world record or tier, everyone on the board has new points, and each total moves by the change.
//!
//! Every recount takes one advisory lock, held to the end of the caller's transaction, so recounts happen one
//! at a time, each from the values the last one stored. They write only this module's tables, never personal
//! bests, so they can't deadlock with the ingest or invalidation, which write personal bests and then recount.

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

/// The formula the stored totals were counted with, or `None` before the first count.
async fn counted_formula(conn: &mut PgConnection) -> Result<Option<PointsFormula>, sqlx::Error> {
    let counted = sqlx::query_scalar!("SELECT formula FROM standings_formula")
        .fetch_optional(&mut *conn)
        .await?;
    Ok(counted.and_then(|counted| serde_json::from_value(counted).ok()))
}

/// After personal bests changed on these runs' boards: recounts their maps' player counts, then those boards.
///
/// The player counts are recounted only here: a tier or policy change moves points, not who has a personal
/// best. They're recounted before this module's lock is taken: the callers' map row locks are what keep them
/// right, and every ingest waits on this lock.
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
    // Under the lock, so the list matches the stored boards the recount compares with.
    lock(conn).await?;
    let boards = sqlx::query_as!(
        Board,
        "SELECT map_id, style, track FROM standings_boards WHERE map_id = $1 AND track = $2",
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

/// Recounts these boards, and the totals they move: those of everyone on a board whose best time or tier
/// changed, and those of `run_ids`' players, who may have a new personal best there or have just lost one.
///
/// Everyone else on a changed board kept their time, so their total moves by their points with the new best
/// and tier less those with the stored ones: one read of the board, not of all their personal bests. The runs'
/// players are summed again, as their own time and completed count may have changed and they may have no row
/// yet. Totals moved by changes can differ from a fresh sum in the last digits; `refresh_all` sums them again.
async fn refresh(
    conn: &mut PgConnection,
    boards: &[Board],
    run_ids: &[i64],
) -> Result<(), sqlx::Error> {
    lock(conn).await?;
    let Some(formula) = counted_formula(conn).await? else {
        // Nothing counted yet, so there's nothing to move: count everything.
        return refresh_all(conn).await;
    };
    let p = formula.policy;
    let map_ids: Vec<i64> = boards.iter().map(|board| board.map_id).collect();
    let styles: Vec<String> = boards.iter().map(|board| board.style.clone()).collect();
    let tracks: Vec<i16> = boards.iter().map(|board| board.track).collect();

    // One statement, so every part reads the stored boards as they were before it: the changes are measured
    // from the old best and tier while the new ones are stored. The first two parts are materialized so each
    // is worked out once: inlined, a prepared statement's generic plan redid them for every personal best.
    sqlx::query!(
        r#"
        WITH now AS MATERIALIZED (
            SELECT b.map_id, b.style, b.track,
                   (SELECT min(pb.time) FROM personal_bests pb
                    WHERE pb.map_id = b.map_id AND pb.style = b.style AND pb.track = b.track) AS best,
                   CASE WHEN $5 THEN (SELECT t.tier FROM current_map_tiers t
                                      WHERE t.map_id = b.map_id AND t.track = b.track) END AS tier
            FROM unnest($1::int8[], $2::text[], $3::int2[]) AS b (map_id, style, track)
        ), runners AS MATERIALIZED (
            SELECT DISTINCT player_steamid64, style, track > 0 AS bonus FROM runs WHERE id = ANY($4)
        ), moved AS (
            SELECT now.*, stored.best AS stored_best, stored.tier AS stored_tier
            FROM now JOIN standings_boards stored USING (map_id, style, track)
            WHERE now.best IS NOT NULL AND (now.best, now.tier) IS DISTINCT FROM (stored.best, stored.tier)
        ), changes AS (
            SELECT pb.style, pb.track > 0 AS bonus, pb.player_steamid64,
                   sum(coalesce(points_for(m.tier, pb.time, m.best, pb.track > 0, $6, $7, $8, $9, $10), 0)
                       - coalesce(points_for(m.stored_tier, pb.time, m.stored_best, pb.track > 0,
                                             $6, $7, $8, $9, $10), 0)) AS change
            FROM moved m
            JOIN personal_bests pb ON pb.map_id = m.map_id AND pb.style = m.style AND pb.track = m.track
            -- The runs' players are summed again below.
            WHERE NOT EXISTS (
                SELECT 1 FROM runners r
                WHERE r.player_steamid64 = pb.player_steamid64 AND r.style = pb.style AND r.bonus = (pb.track > 0)
            )
            GROUP BY 1, 2, 3
        ), moved_totals AS (
            UPDATE standings s SET points = s.points + c.change FROM changes c
            WHERE s.style = c.style AND s.bonus = c.bonus AND s.player_steamid64 = c.player_steamid64
              AND c.change <> 0
        ), emptied AS (
            DELETE FROM standings_boards stored USING now
            WHERE stored.map_id = now.map_id AND stored.style = now.style AND stored.track = now.track
              AND now.best IS NULL
        )
        INSERT INTO standings_boards (map_id, style, track, best, tier)
        SELECT map_id, style, track, best, tier FROM now WHERE best IS NOT NULL
        ON CONFLICT (map_id, style, track) DO UPDATE SET best = excluded.best, tier = excluded.tier
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

    sum_runners_again(conn, run_ids, &formula.policy).await
}

/// The runs' players' totals, summed again from the boards as now stored. Delete-then-insert under the lock: a
/// player who no longer has a personal best there loses their row.
async fn sum_runners_again(
    conn: &mut PgConnection,
    run_ids: &[i64],
    p: &PointsPolicy,
) -> Result<(), sqlx::Error> {
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
            SELECT sum(coalesce(points_for(b.tier, pb.time, b.best, pb.track > 0, $2, $3, $4, $5, $6), 0))
                       AS points,
                   count(*) AS completed
            FROM personal_bests pb
            LEFT JOIN standings_boards b ON b.map_id = pb.map_id AND b.style = pb.style AND b.track = pb.track
            WHERE pb.player_steamid64 = a.player_steamid64 AND pb.style = a.style AND (pb.track > 0) = a.bonus
        ) totals
        WHERE totals.completed > 0
        "#,
        run_ids,
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

/// Recounts everything, 2.0 and legacy, with the formula in force, and records that formula.
///
/// It writes the boards and totals alone, so personal bests stay free for the ingest; runs stored meanwhile
/// wait on the lock to recount, then do so from what this stored.
pub async fn refresh_all(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    lock(conn).await?;
    let formula = formula(conn).await?;
    let p = formula.policy;
    sqlx::query!("DELETE FROM standings_boards")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO standings_boards (map_id, style, track, best, tier)
        SELECT b.map_id, b.style, b.track, b.best, t.tier
        FROM (SELECT map_id, style, track, min(time) AS best FROM personal_bests GROUP BY 1, 2, 3) b
        LEFT JOIN current_map_tiers t ON $1 AND t.map_id = b.map_id AND t.track = b.track
        "#,
        formula.tiers
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!("DELETE FROM standings")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO standings (style, bonus, player_steamid64, points, completed)
        SELECT pb.style, pb.track > 0, pb.player_steamid64,
               sum(coalesce(points_for(b.tier, pb.time, b.best, pb.track > 0, $1, $2, $3, $4, $5), 0)), count(*)
        FROM personal_bests pb
        JOIN standings_boards b ON b.map_id = pb.map_id AND b.style = pb.style AND b.track = pb.track
        GROUP BY 1, 2, 3
        "#,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
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

/// Runs once after startup, beside requests: recounts everything if the formula in force isn't the one the
/// stored totals were counted with, as after a new draft or formula in code. Until it's done, pages show the
/// totals counted before, with the points they were counted with, and runs stored meanwhile wait to recount.
pub async fn recount_if_stale(db: PgPool) {
    match refresh_if_stale(&db).await {
        Ok(true) => tracing::info!("recounted points and standings with the formula in force"),
        Ok(false) => {}
        Err(error) => {
            tracing::error!(%error, "recounting the standings failed; restart to try again");
        }
    }
}

/// Recounts everything if the formula in force isn't the one the stored totals were counted with. Returns
/// whether it did.
pub async fn refresh_if_stale(db: &PgPool) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let in_force = formula(&mut tx).await?;
    if counted_formula(&mut tx).await?.as_ref() == Some(&in_force) {
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

    /// Fails if the stored totals or boards differ from a full recount, beyond the last digits that moving
    /// totals by changes can leave. The recount is rolled back.
    pub(crate) async fn assert_totals_current(db: &PgPool) {
        async fn read(
            conn: &mut sqlx::PgConnection,
        ) -> (Vec<(String, bool, i64, f64, i32)>, Vec<String>) {
            let totals = sqlx::query_as(
                "SELECT style, bonus, player_steamid64, points, completed FROM standings ORDER BY 1, 2, 3",
            )
            .fetch_all(&mut *conn)
            .await
            .unwrap();
            let boards = sqlx::query_scalar(
                "SELECT concat_ws(' ', map_id, style, track, best, tier) FROM standings_boards ORDER BY 1",
            )
            .fetch_all(&mut *conn)
            .await
            .unwrap();
            (totals, boards)
        }
        // What pages show adds up to the stored totals.
        let unequal: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM standings s
             JOIN (SELECT style, track > 0 AS bonus, player_steamid64,
                          sum(personal_best_points(map_id, style, track, time)) AS points
                   FROM personal_bests GROUP BY 1, 2, 3) shown USING (style, bonus, player_steamid64)
             WHERE abs(s.points - shown.points) > 1e-6",
        )
        .fetch_one(db)
        .await
        .unwrap();
        assert_eq!(
            unequal, 0,
            "points shown on pages don't add up to the stored totals"
        );
        let mut tx = db.begin().await.unwrap();
        let (stored, stored_boards) = read(&mut tx).await;
        super::refresh_all(&mut tx).await.unwrap();
        let (fresh, fresh_boards) = read(&mut tx).await;
        tx.rollback().await.unwrap();
        assert_eq!(stored_boards, fresh_boards, "stored boards drifted");
        let same = stored.len() == fresh.len()
            && stored.iter().zip(&fresh).all(|(s, f)| {
                (&s.0, s.1, s.2, s.4) == (&f.0, f.1, f.2, f.4) && (s.3 - f.3).abs() < 1e-6
            });
        assert!(same, "stored totals drifted:\n{stored:?}\n{fresh:?}");
    }

    /// The ingest writes a personal best, then recounts. A full recount started in between counts without it,
    /// and the ingest's own recount then counts it: no deadlock, and nothing missed.
    #[sqlx::test]
    async fn a_full_recount_waits_for_a_run_being_stored(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let run_id: i64 = sqlx::query_scalar("SELECT run_id FROM personal_bests")
            .fetch_one(&db)
            .await
            .unwrap();

        // As the ingest does: the map's row and the personal best's first, the recount after.
        let mut ingest = db.begin().await.unwrap();
        sqlx::query(
            "INSERT INTO maps (name) VALUES ('bhop_badges') ON CONFLICT (name) DO UPDATE SET name = excluded.name",
        )
        .execute(&mut *ingest)
        .await
        .unwrap();
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
        assert_totals_current(&db).await;
    }

    /// A tier change waiting for the standings lock, then a full recount behind it. They once deadlocked, when
    /// recounts wrote personal bests.
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
