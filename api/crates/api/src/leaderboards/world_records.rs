//! Stored world records: `world_record_holders` (who holds each board's record now) and `runs.was_record`
//! (whether a run was a record when it was set), kept current so profiles, the points leaderboards, Activity,
//! WR history and the Discord feeds read them instead of comparing every personal best or run with its board.
//! The pre-2.0 record history (`legacy.rs`) works its own out, as legacy runs have no stored flag.
//!
//! Both change only when a board's runs or personal bests do, so the two places that change those call
//! `refresh` for the boards they touched: the ingest, for every valid run it stores, and run invalidation
//! and restoring. A run arriving late, with an earlier finish time, can take the record-when-set from runs
//! after it, so its board is redone from that run on, not just the run itself.
//!
//! Concurrency: each refresh reads the board from what's committed, under the board's map row lock. The ingest
//! already holds it (`maps::record_run` updates the row); invalidation takes it with `lock_maps` before
//! anything else that the ingest locks after it, so the two can't deadlock.

use sqlx::{PgConnection, PgPool};

/// Takes the map row lock for every board these runs are on, in map ID order, so two invalidations can't
/// deadlock either. Called before the runs' personal bests are recomputed, which takes the standings lock.
pub async fn lock_maps(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"SELECT id FROM maps WHERE id IN (SELECT map_id FROM runs WHERE id = ANY($1))
           ORDER BY id FOR UPDATE"#,
        run_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(())
}

/// Redoes the record holders and every run's record-when-set on the boards (map, style, track) these runs
/// are on. Only rows that change are written. Returns how many did.
pub async fn refresh(conn: &mut PgConnection, run_ids: &[i64]) -> Result<u64, sqlx::Error> {
    let removed = sqlx::query!(
        r#"
        WITH boards AS (SELECT DISTINCT map_id, style, track FROM runs WHERE id = ANY($1))
        DELETE FROM world_record_holders h USING boards b
        WHERE h.map_id = b.map_id AND h.style = b.style AND h.track = b.track
          AND EXISTS (
              SELECT 1 FROM personal_bests pb JOIN personal_bests faster
                ON faster.map_id = pb.map_id AND faster.style = pb.style AND faster.track = pb.track
               AND faster.time < pb.time
              WHERE pb.player_steamid64 = h.player_steamid64 AND pb.map_id = h.map_id
                AND pb.style = h.style AND pb.track = h.track
          )
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    let added = sqlx::query!(
        r#"
        WITH boards AS (SELECT DISTINCT map_id, style, track FROM runs WHERE id = ANY($1)),
        -- Each board's best time, from the `personal_bests_board` index: its holders are those who have it.
        bests AS (
            SELECT b.*, (SELECT min(pb.time) FROM personal_bests pb
                         WHERE pb.map_id = b.map_id AND pb.style = b.style AND pb.track = b.track) AS time
            FROM boards b
        )
        INSERT INTO world_record_holders (player_steamid64, map_id, style, track)
        SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track
        FROM bests b
        JOIN personal_bests pb ON pb.map_id = b.map_id AND pb.style = b.style AND pb.track = b.track
                              AND pb.time = b.time
        ON CONFLICT DO NOTHING
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    // Only these runs and later ones on their boards can change, "later" in WR history's order: finish time,
    // then ID. The board's best before the earliest of them is the latest record before it, which the
    // `runs_board_records` index finds at once (migration 0049), so a run arriving now reads itself alone
    // rather than its whole board (external audit, 2026-11-06). An invalid run is never a record.
    let flagged = sqlx::query!(
        r#"
        WITH starts AS (
            SELECT DISTINCT ON (map_id, style, track) map_id, style, track, finished_at, id
            FROM runs WHERE id = ANY($1)
            ORDER BY map_id, style, track, finished_at, id
        ), bests AS (
            SELECT s.*, (SELECT r.time FROM runs r
                         WHERE r.map_id = s.map_id AND r.style = s.style AND r.track = s.track AND r.was_record
                           AND (r.finished_at, r.id) < (s.finished_at, s.id)
                         ORDER BY r.finished_at DESC, r.id DESC LIMIT 1) AS best
            FROM starts s
        ), placed AS (
            SELECT r.id,
                   -- LEAST skips NULLs: no record before the start, or no valid run between it and this one.
                   r.invalidated_at IS NULL AND r.time < coalesce(LEAST(b.best,
                       min(r.time) FILTER (WHERE r.invalidated_at IS NULL) OVER (
                           PARTITION BY r.map_id, r.style, r.track ORDER BY r.finished_at, r.id
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)),
                       'infinity') AS was_record
            FROM runs r
            JOIN bests b ON b.map_id = r.map_id AND b.style = r.style AND b.track = r.track
                        AND (r.finished_at, r.id) >= (b.finished_at, b.id)
        )
        UPDATE runs r SET was_record = placed.was_record FROM placed
        WHERE r.id = placed.id AND r.was_record <> placed.was_record
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(removed + added + flagged)
}

/// Redoes every board, for `world-records rebuild` and the tests that check nothing drifted. Returns how many
/// rows changed: 0 when the stored records were already right.
pub async fn rebuild(db: &PgPool) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    // Each board's earliest run names it, so every run on it is redone.
    let run_ids = sqlx::query_scalar!(
        r#"SELECT DISTINCT ON (map_id, style, track) id FROM runs ORDER BY map_id, style, track, finished_at, id"#
    )
            .fetch_all(&mut *tx)
            .await?;
    let changed = refresh(&mut tx, &run_ids).await?;
    tx.commit().await?;
    Ok(changed)
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    /// Fails if the stored world records differ from a recount. Tests of everything that changes runs or
    /// personal bests call it.
    pub(crate) async fn assert_current(db: &PgPool) {
        assert_eq!(
            super::rebuild(db).await.unwrap(),
            0,
            "stored world records drifted"
        );
    }

    async fn holders(db: &PgPool) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT p.name FROM world_record_holders h
             JOIN players p ON p.steamid64 = h.player_steamid64 ORDER BY p.name",
        )
        .fetch_all(db)
        .await
        .unwrap()
    }

    async fn records_when_set(db: &PgPool) -> Vec<String> {
        sqlx::query_scalar("SELECT server_run_id FROM runs WHERE was_record ORDER BY server_run_id")
            .fetch_all(db)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn follow_new_runs_ties_and_late_arrivals(db: PgPool) {
        let key = setup(&db).await;
        let now = chrono::Utc::now().timestamp();
        let send = async |id: &str, time: f64, steamid64: &str, name: &str, ago: i64| {
            let mut body = run(id, time);
            body["player"] = json!({ "steamid64": steamid64, "name": name });
            body["finished_at"] = json!(now - ago);
            let sent = test_client::post(&db, "/v1/runs", Some(&key), &body).await;
            assert_eq!(sent.status, 201, "{:?}", sent.body);
        };
        send("a1", 30.0, "76561197960287930", "gabe", 300).await;
        send("b1", 25.0, "76561197960287931", "ricochet", 200).await;
        assert_eq!(holders(&db).await, ["ricochet"]);
        assert_eq!(records_when_set(&db).await, ["a1", "b1"]);

        // A tie for first: both hold it, and the later run wasn't a record when it was set.
        send("a2", 25.0, "76561197960287930", "gabe", 100).await;
        assert_eq!(holders(&db).await, ["gabe", "ricochet"]);
        assert_eq!(records_when_set(&db).await, ["a1", "b1"]);

        // A queued run that finished before all of them: it was the record then, and the first run no
        // longer was. It doesn't change who holds the record now.
        send("c1", 28.0, "76561197960287940", "alice", 400).await;
        assert_eq!(records_when_set(&db).await, ["b1", "c1"]);
        assert_eq!(holders(&db).await, ["gabe", "ricochet"]);

        // One that lands in the middle: the best before it is c1's 28, the latest record before it.
        send("d1", 27.0, "76561197960287941", "bob", 250).await;
        assert_eq!(records_when_set(&db).await, ["b1", "c1", "d1"]);
        // Slower than c1 and in the middle too: not a record, and nothing after it moves.
        send("e1", 29.0, "76561197960287942", "eve", 350).await;
        assert_eq!(records_when_set(&db).await, ["b1", "c1", "d1"]);
        assert_current(&db).await;
    }
}
