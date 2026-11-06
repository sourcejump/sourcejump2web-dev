//! Pre-2.0 records: the old sourcejump.net's maps, players and runs, imported from its database dump into the
//! `legacy_*` tables, and its ban list carried over as 2.0 bans.
//!
//! How they're shown (lead, 2026-10-26): boards and profiles show 2.0 runs by default, and "2.0 + pre-2.0"
//! and "Pre-2.0" are views to switch to, with legacy runs marked. Those views are for display only: WRs, WR
//! history, points and 2.0 placements count 2.0 runs alone.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, maps::wr_history::WrHistoryEntry, players::PlayerRef};

mod dump;
pub mod import;
pub mod run;

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(run::legacy_run_detail))
}

/// The one board legacy runs belong on. The old site had no styles or bonuses, and its runs were auto-bhop on
/// the main track: 2.0's `normal` style, track 0.
pub const STYLE: &str = "normal";
pub const TRACK: i16 = 0;

/// Which runs a board or profile shows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum View {
    /// 2.0 runs only, the default.
    #[default]
    Current,
    /// 2.0 and legacy runs together: each player's or map's fastest of either.
    All,
    /// Legacy runs only.
    Legacy,
}

impl View {
    /// The views other than `Current` exist only on the legacy board; asking for them elsewhere is a mistake
    /// the caller should hear about.
    pub fn check_board(self, style: &str, track: i16) -> Result<(), String> {
        if self == Self::Current || (style == STYLE && track == TRACK) {
            Ok(())
        } else {
            Err(format!(
                "pre-2.0 runs are only on the {STYLE} style's main track"
            ))
        }
    }
}

/// How many players a map's pre-2.0 board shows, banned players left out; None when the old site didn't know
/// the map.
pub async fn board_players(db: &PgPool, map: &str) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT (SELECT count(*) FROM legacy_personal_bests l
                   WHERE l.map_id = lm.id AND NOT EXISTS (
                       SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64
                   )) AS "players!"
           FROM legacy_maps lm WHERE lm.name = $1"#,
        map,
    )
    .fetch_optional(db)
    .await
}

/// A map's pre-2.0 board in numbers, banned players' runs left out, for the views a map page switches to.
pub struct BoardTotals {
    /// Players on the pre-2.0 board.
    pub players: i64,
    /// Every pre-2.0 run on it, not just personal bests.
    pub runs: i64,
    /// Players on the "2.0 + pre-2.0" view: each counted once, whichever kind of run they have.
    pub all_players: i64,
    /// When the latest dated pre-2.0 run on it finished, where the record history's last step runs on to.
    pub last_run_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// The totals of a map's pre-2.0 board and its "2.0 + pre-2.0" view; None when the old site didn't know the map.
pub async fn board_totals(db: &PgPool, map: &str) -> Result<Option<BoardTotals>, sqlx::Error> {
    sqlx::query_as!(
        BoardTotals,
        r#"SELECT
               (SELECT count(*) FROM legacy_personal_bests l
                WHERE l.map_id = lm.id
                  AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
               ) AS "players!",
               (SELECT count(*) FROM legacy_runs l
                WHERE l.map_id = lm.id
                  AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
               ) AS "runs!",
               (SELECT count(*) FROM (
                    SELECT l.player_steamid64 FROM legacy_personal_bests l
                    WHERE l.map_id = lm.id
                      AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
                    UNION
                    SELECT pb.player_steamid64 FROM personal_bests pb
                    JOIN maps m ON m.id = pb.map_id
                    WHERE m.name = $1 AND pb.style = $2 AND pb.track = $3
                ) both_kinds) AS "all_players!",
               (SELECT max(l.finished_at) FROM legacy_runs l
                WHERE l.map_id = lm.id
                  AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
               ) AS last_run_at
           FROM legacy_maps lm WHERE lm.name = $1"#,
        map,
        STYLE,
        TRACK
    )
    .fetch_optional(db)
    .await
}

/// A map's pre-2.0 record history: every legacy run faster than all legacy runs finished before it, oldest
/// first, by the same rule as 2.0's WR history. For display on the "Pre-2.0" view only; these were never 2.0
/// world records. Banned players' runs are left out, as on the board, and undated runs, which have no place in
/// the order. Each entry's `run_id` is the old site's.
pub async fn record_history(db: &PgPool, map: &str) -> Result<Vec<WrHistoryEntry>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT r.id, r.time, r.finished_at AS "finished_at!",
               r.player_steamid64::text AS "steamid64!", coalesce(p.name, lp.name) AS "name!",
               coalesce(p.avatar_url, lp.avatar_url) AS avatar_url,
               coalesce(p.country_code, lp.country_code) AS country_code
        FROM (
            SELECT l.id, l.player_steamid64, l.time, l.finished_at,
                   min(l.time) OVER (
                       ORDER BY l.finished_at, l.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ) AS best_before
            FROM legacy_runs l
            JOIN legacy_maps lm ON lm.id = l.map_id
            WHERE lm.name = $1 AND l.finished_at IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64
            )
        ) r
        JOIN legacy_players lp ON lp.steamid64 = r.player_steamid64
        LEFT JOIN players p ON p.steamid64 = r.player_steamid64
        WHERE r.best_before IS NULL OR r.time < r.best_before
        ORDER BY r.finished_at, r.id
        "#,
        map,
    )
    .fetch_all(db)
    .await?;

    let mut previous: Option<f64> = None;
    Ok(rows
        .into_iter()
        .map(|row| {
            // Rounded to the millisecond, the precision times are shown in, without float noise.
            let improvement =
                previous.map(|before| ((before - row.time) * 1000.0).round() / 1000.0);
            previous = Some(row.time);
            WrHistoryEntry {
                player: PlayerRef {
                    steamid64: row.steamid64,
                    name: row.name,
                    avatar_url: row.avatar_url,
                    country_code: row.country_code,
                },
                time: row.time,
                run_id: i64::from(row.id),
                finished_at: row.finished_at,
                improvement,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use sqlx::PgPool;

    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    const GABE: &str = "76561197960287930";
    const ALICE: &str = "76561197960287940";
    const CHEAT: &str = "76561197960287941";

    /// gabe has a 2.0 run of 30 s on `bhop_badges` and a slower legacy one; alice and a banned player have only
    /// legacy runs there, and alice one on a map 2.0 hasn't seen.
    async fn fixture(db: &PgPool) {
        let key = setup(db).await;
        test_client::post(db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO legacy_maps (id, name, points) VALUES (1, 'bhop_badges', 0), (2, 'bhop_oldonly', 0);
             INSERT INTO legacy_players (steamid64, name) VALUES
                 ({GABE}, 'gabe_old'), ({ALICE}, 'alice'), ({CHEAT}, 'cheat');
             INSERT INTO legacy_runs
                 (id, map_id, player_steamid64, player_name, server_hostname, time, sync, strafes, jumps,
                  finished_at, initial_record)
             VALUES (1, 1, {GABE}, 'gabe', 's', 32, 90, 1, 1, '2020-01-01', false),
                    (2, 1, {ALICE}, 'alice', 's', 25, 90, 1, 1, '2020-01-02', false),
                    (3, 1, {ALICE}, 'alice', 's', 27, 90, 1, 1, '2020-01-01', false),
                    (4, 1, {CHEAT}, 'cheat', 's', 20, 90, 1, 1, NULL, false),
                    (5, 2, {ALICE}, 'alice', 's', 40, 90, 1, 1, '2020-01-03', false);
             INSERT INTO players (steamid64, name, name_seen_at) VALUES ({CHEAT}, 'cheat', '-infinity');
             WITH entry AS (
                 INSERT INTO staff_log (action, target, reason) VALUES ('ban_player', '{CHEAT}', 'x') RETURNING id
             )
             INSERT INTO bans (player_steamid64, restrictions, reason, log_id) SELECT {CHEAT}, 1, 'x', id FROM entry;"
        )))
        .execute(db)
        .await
        .unwrap();
    }

    async fn get(db: &PgPool, path: &str) -> Value {
        test_client::get(db, path).await.json()
    }

    /// (name, time, legacy) of a leaderboard's entries.
    fn board(page: &Value) -> Vec<(String, f64, bool)> {
        page["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["player"]["name"].as_str().unwrap().to_owned(),
                    e["time"].as_f64().unwrap(),
                    e["legacy"].as_bool().unwrap(),
                )
            })
            .collect()
    }

    #[sqlx::test]
    async fn the_pre_2_0_view_has_its_own_record_history_and_runs(db: PgPool) {
        fixture(&db).await;
        // By finish date: gabe's 32 is the first record, alice's 27 on the same day beats it, then her 25. The
        // banned player's faster, undated run is left out.
        let map = get(&db, "/v1/maps/bhop_badges").await;
        let history: Vec<_> = map["legacy_record_history"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["run_id"].as_i64().unwrap(),
                    r["time"].as_f64().unwrap(),
                    r["improvement"].as_f64(),
                )
            })
            .collect();
        assert_eq!(
            history,
            [(1, 32.0, None), (3, 27.0, Some(5.0)), (2, 25.0, Some(2.0))]
        );
        // The last record's step runs on to the latest dated run; the banned player's is undated anyway.
        assert_eq!(map["legacy_last_run_at"], "2020-01-02T00:00:00Z");
        // 2.0's own WR history is untouched.
        assert_eq!(
            map["tracks"][0]["styles"][0]["wr_history"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let old_only = get(&db, "/v1/maps/bhop_oldonly").await;
        assert_eq!(
            old_only["legacy_record_history"].as_array().unwrap().len(),
            1
        );

        let run = get(&db, "/v1/legacy-runs/3").await;
        assert_eq!(run["map"], "bhop_badges");
        assert_eq!(run["time"], 27.0);
        assert_eq!(run["record_time"], 25.0);
        assert_eq!(run["server_name"], "s");
        // A banned player's run is hidden, as on the board.
        for missing in [
            "/v1/legacy-runs/4",
            "/v1/legacy-runs/99",
            "/v1/legacy-runs/99999999999",
        ] {
            assert_eq!(
                test_client::get(&db, missing).await.status,
                404,
                "{missing}"
            );
        }
    }

    #[sqlx::test]
    async fn boards_show_legacy_runs_only_in_their_views(db: PgPool) {
        fixture(&db).await;
        let path = "/v1/maps/bhop_badges/leaderboard?style=normal";

        let current = get(&db, path).await;
        assert_eq!(board(&current), [("gabe".to_owned(), 30.0, false)]);

        // Each player's faster run of either kind; the banned player is left out.
        let all = get(&db, &format!("{path}&view=all")).await;
        assert_eq!(
            board(&all),
            [
                ("alice".to_owned(), 25.0, true),
                ("gabe".to_owned(), 30.0, false)
            ]
        );
        assert_eq!(all["world_record_time"], 30.0);
        assert_eq!(all["fastest_time"], 25.0);

        let first = get(&db, &format!("{path}&view=legacy&limit=1")).await;
        assert_eq!(board(&first), [("alice".to_owned(), 25.0, true)]);
        let cursor = first["next_cursor"].as_str().unwrap();
        let second = get(&db, &format!("{path}&view=legacy&limit=1&cursor={cursor}")).await;
        // A player's 2.0 name wins over their old one.
        assert_eq!(board(&second), [("gabe".to_owned(), 32.0, true)]);
        assert_eq!(second["total"], 2);

        let elsewhere = "/v1/maps/bhop_badges/leaderboard?style=sw&view=all";
        assert_eq!(test_client::get(&db, elsewhere).await.status, 422);
    }

    #[sqlx::test]
    async fn map_totals_count_each_view(db: PgPool) {
        fixture(&db).await;

        let map = get(&db, "/v1/maps/bhop_badges").await;
        // alice's two runs and gabe's one; the banned player's run is left out.
        assert_eq!(map["legacy_runs"], 3);
        // gabe has runs of both kinds and counts once.
        assert_eq!(map["all_players"], 2);
        assert_eq!(map["tracks"][0]["styles"][0]["runs"], 1);
    }

    #[sqlx::test]
    async fn maps_and_players_known_only_from_legacy_records_have_pages(db: PgPool) {
        fixture(&db).await;

        assert_eq!(get(&db, "/v1/maps/bhop_badges").await["legacy_players"], 2);
        let old_map = get(&db, "/v1/maps/bhop_oldonly").await;
        assert_eq!(old_map["created_at"], Value::Null);
        assert_eq!(old_map["tracks"], serde_json::json!([]));
        assert_eq!(old_map["legacy_players"], 1);
        let old_board = get(
            &db,
            "/v1/maps/bhop_oldonly/leaderboard?style=normal&view=all",
        )
        .await;
        assert_eq!(board(&old_board), [("alice".to_owned(), 40.0, true)]);
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_none").await.status,
            404
        );

        let alice = get(&db, &format!("/v1/players/{ALICE}")).await;
        assert_eq!(alice["name"], "alice");
        assert_eq!(alice["styles"], serde_json::json!([]));
        assert_eq!(alice["legacy_maps"], 2);
        assert_eq!(
            get(&db, &format!("/v1/players/{CHEAT}")).await["legacy_maps"],
            0
        );

        let pbs = get(
            &db,
            &format!("/v1/players/{ALICE}/personal-bests?style=normal&view=legacy"),
        )
        .await;
        let maps: Vec<_> = pbs["personal_bests"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pb| (pb["map"].as_str().unwrap(), pb["time"].as_f64().unwrap()))
            .collect();
        assert_eq!(maps, [("bhop_badges", 25.0), ("bhop_oldonly", 40.0)]);

        let gabe = get(
            &db,
            &format!("/v1/players/{GABE}/personal-bests?style=normal&view=all"),
        )
        .await;
        let pb = &gabe["personal_bests"][0];
        assert_eq!(
            (pb["time"].as_f64(), pb["legacy"].as_bool()),
            (Some(30.0), Some(false))
        );
        assert_eq!(pb["rank"], 1);

        let found = get(&db, "/v1/players?q=alic").await;
        assert_eq!(found["players"][0]["steamid64"], ALICE);
    }
}
