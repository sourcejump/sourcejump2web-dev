//! The site-wide leaderboards, `GET /v1/leaderboards`: in one style, main tracks or bonuses, the top players
//! by points and by tracks completed. The pre-2.0 view ranks legacy records instead; they never count toward
//! 2.0 (`docs/domain.md`). Points and totals are stored (`standings.rs`), so this only reads.

pub mod list;
pub mod standings;
pub mod world_records;

use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::{default_style, played_count},
    players::PlayerRef,
};
use standings::PointsFormula;

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(leaderboards))
        .routes(routes!(list::leaderboard_list))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LeaderboardTrack {
    Main,
    Bonuses,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LeaderboardView {
    /// 2.0 runs.
    Current,
    /// Legacy records: one style's main tracks, counted on the old site's tiers. Style and track don't apply.
    Legacy,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct LeaderboardsQuery {
    /// Default: the first style in the current ruleset.
    style: Option<String>,
    /// Default `main`.
    #[param(inline)]
    track: Option<LeaderboardTrack>,
    /// Default `current`.
    #[param(inline)]
    view: Option<LeaderboardView>,
    /// Players per list, 1 to 100. Default 20.
    limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Leaderboards {
    /// None if no ruleset is published, and for the legacy view.
    pub style: Option<String>,
    pub track: LeaderboardTrack,
    pub view: LeaderboardView,
    /// What completed tracks are counted out of: maps or bonus tracks with a run.
    pub out_of: i64,
    /// The formula points are counted with.
    pub points: PointsFormula,
    /// Most points first. Players without points are left off.
    pub top_players: Vec<Standing>,
    /// Most tracks completed first.
    pub completed: Vec<Standing>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Standing {
    /// Equal values share a rank.
    pub rank: i64,
    pub player: PlayerRef,
    /// Rounded to a whole point.
    pub points: i64,
    /// Tracks finished: maps, or bonus tracks.
    pub completed: i64,
}

/// A row of either list: whether it's from the points list, then the standing.
type Row = (bool, Standing);

/// The top players by points and by completions, in one style and kind of track.
#[utoipa::path(
    get,
    path = "/v1/leaderboards",
    tag = "leaderboards",
    params(LeaderboardsQuery),
    responses(
        (status = OK, body = Leaderboards),
        (status = UNPROCESSABLE_ENTITY, description = "Limit out of range", body = ErrorBody),
    ),
)]
pub async fn leaderboards(
    State(state): State<AppState>,
    Query(query): Query<LeaderboardsQuery>,
) -> Result<Json<Leaderboards>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let view = query.view.unwrap_or(LeaderboardView::Current);
    let points = standings::formula(&mut *state.db.acquire().await?).await?;
    let (style, track, out_of, rows) = match view {
        LeaderboardView::Current => {
            let track = query.track.unwrap_or(LeaderboardTrack::Main);
            let style = match query.style {
                Some(style) => Some(style),
                None => default_style(&state.db).await?,
            };
            let out_of = out_of(&state.db, view, track).await?;
            let rows = current(&state.db, style.as_deref(), track, limit).await?;
            (style, track, out_of, rows)
        }
        LeaderboardView::Legacy => {
            let out_of = out_of(&state.db, view, LeaderboardTrack::Main).await?;
            (
                None,
                LeaderboardTrack::Main,
                out_of,
                legacy(&state.db, limit).await?,
            )
        }
    };
    let (top_players, completed): (Vec<Row>, Vec<Row>) =
        rows.into_iter().partition(|(by_points, _)| *by_points);
    let standings = |rows: Vec<Row>| rows.into_iter().map(|(_, standing)| standing).collect();
    Ok(Json(Leaderboards {
        style,
        track,
        view,
        out_of,
        points,
        top_players: standings(top_players),
        completed: standings(completed),
    }))
}

/// What completions are counted out of: maps or bonus tracks with a run, or maps with a legacy run.
async fn out_of(
    db: &sqlx::PgPool,
    view: LeaderboardView,
    track: LeaderboardTrack,
) -> Result<i64, sqlx::Error> {
    match (view, track) {
        (LeaderboardView::Legacy, _) => {
            // Stored by the import, the only writer of legacy runs.
            sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM legacy_maps WHERE has_runs"#)
                .fetch_one(db)
                .await
        }
        (LeaderboardView::Current, LeaderboardTrack::Main) => played_count(db).await,
        (LeaderboardView::Current, LeaderboardTrack::Bonuses) => bonus_count(db).await,
    }
}

/// Bonus tracks somebody has finished.
async fn bonus_count(db: &sqlx::PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM (SELECT DISTINCT map_id, track FROM personal_bests WHERE track > 0) b"#
    )
    .fetch_one(db)
    .await
}

/// Both lists in one query. Ties go by name.
async fn current(
    db: &sqlx::PgPool,
    style: Option<&str>,
    track: LeaderboardTrack,
    limit: i64,
) -> Result<Vec<Row>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        -- Ranked on the points shown, so players listed with equal points share a place.
        (SELECT true AS "by_points!", rank() OVER (ORDER BY round(s.points) DESC) AS "rank!",
                round(s.points)::int8 AS "points!", s.completed::int8 AS "completed!",
                p.steamid64::text AS "steamid64!", p.name AS "name!", p.avatar_url, p.country_code
         FROM standings s JOIN players p ON p.steamid64 = s.player_steamid64
         WHERE s.style = $1 AND s.bonus = $2 AND s.points > 0
         ORDER BY s.points DESC, lower(p.name), s.player_steamid64 LIMIT $3)
        UNION ALL
        (SELECT false, rank() OVER (ORDER BY s.completed DESC), round(s.points)::int8, s.completed::int8,
                p.steamid64::text, p.name, p.avatar_url, p.country_code
         FROM standings s JOIN players p ON p.steamid64 = s.player_steamid64
         WHERE s.style = $1 AND s.bonus = $2
         ORDER BY s.completed DESC, lower(p.name), s.player_steamid64 LIMIT $3)
        "#,
        style,
        track == LeaderboardTrack::Bonuses,
        limit
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let player = PlayerRef {
                steamid64: row.steamid64,
                name: row.name,
                avatar_url: row.avatar_url,
                country_code: row.country_code,
            };
            let standing = Standing {
                rank: row.rank,
                player,
                points: row.points,
                completed: row.completed,
            };
            (row.by_points, standing)
        })
        .collect())
}

/// The legacy lists, leaving out players banned from records as every legacy view does. Ranks and places are
/// stored by the recount, which already leaves banned players out; the check here is a second guard.
async fn legacy(db: &sqlx::PgPool, limit: i64) -> Result<Vec<Row>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        WITH shown AS (
            SELECT s.* FROM legacy_standings s
            WHERE NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = s.player_steamid64)
        ), listed AS (
            (SELECT true AS by_points, points_rank AS rank, points_place AS place, player_steamid64, points, completed
             FROM shown WHERE points > 0 ORDER BY points_place LIMIT $1)
            UNION ALL
            (SELECT false, completed_rank, completed_place, player_steamid64, points, completed
             FROM shown ORDER BY completed_place LIMIT $1)
        )
        SELECT l.by_points AS "by_points!", l.rank::int8 AS "rank!", round(l.points)::int8 AS "points!",
               l.completed::int8 AS "completed!", l.player_steamid64::text AS "steamid64!", p.name AS "name!",
               p.avatar_url, p.country_code
        FROM listed l JOIN legacy_players p ON p.steamid64 = l.player_steamid64
        ORDER BY l.by_points DESC, l.place
        "#,
        limit,
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let player = PlayerRef {
                steamid64: row.steamid64,
                name: row.name,
                avatar_url: row.avatar_url,
                country_code: row.country_code,
            };
            let standing = Standing {
                rank: row.rank,
                player,
                points: row.points,
                completed: row.completed,
            };
            (row.by_points, standing)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::{Leaderboards, standings};
    use crate::{
        maps::MapName,
        policies::{Policy, TiersPolicy},
        runs::tests::{run, setup},
        staff, test_client,
    };

    const RICOCHET: &str = "76561197960287931";

    /// (name, rank, points, completed) per list.
    type Lists = (Vec<(String, i64, i64, i64)>, Vec<(String, i64, i64, i64)>);

    async fn lists(db: &PgPool, query: &str) -> Lists {
        let board: Leaderboards = test_client::get(db, &format!("/v1/leaderboards?{query}"))
            .await
            .json();
        let rows = |list: Vec<super::Standing>| {
            list.into_iter()
                .map(|s| (s.player.name, s.rank, s.points, s.completed))
                .collect()
        };
        (rows(board.top_players), rows(board.completed))
    }

    async fn submit(
        db: &PgPool,
        key: &str,
        id: &str,
        map: &str,
        track: i16,
        time: f64,
        ricochet: bool,
    ) {
        let mut body = run(id, time);
        body["map"] = json!(map);
        body["track"] = json!(track);
        if ricochet {
            body["player"] = json!({ "steamid64": RICOCHET, "name": "ricochet" });
        }
        let response = test_client::post(db, "/v1/runs", Some(key), &body).await;
        assert_eq!(response.status, 201);
    }

    fn row(name: &str, rank: i64, points: i64, completed: i64) -> (String, i64, i64, i64) {
        (name.to_owned(), rank, points, completed)
    }

    #[sqlx::test]
    async fn stored_points_follow_runs_tiers_and_invalidation(db: PgPool) {
        let key = setup(&db).await;
        submit(&db, &key, "a", "bhop_badges", 0, 30.0, false).await;
        submit(&db, &key, "b", "bhop_badges", 0, 33.0, true).await;
        submit(&db, &key, "c", "bhop_arcane", 0, 20.0, true).await;
        submit(&db, &key, "d", "bhop_arcane", 1, 9.0, true).await;

        // No tiers yet: nobody has points, but completions count. Equal counts share a rank.
        let (top, completed) = lists(&db, "").await;
        assert_eq!(top.len(), 0);
        assert_eq!(completed, [row("ricochet", 1, 0, 2), row("gabe", 2, 0, 1)]);

        staff::policies::publish_policy(
            &db,
            None,
            None,
            &Policy::Tiers(TiersPolicy { count: 5 }),
            None,
        )
        .await
        .unwrap();
        for (map, track, tier) in [
            ("bhop_badges", 0, 3),
            ("bhop_arcane", 0, 1),
            ("bhop_arcane", 1, 2),
        ] {
            let map = MapName::try_from(map.to_owned()).unwrap();
            staff::maps::set_tier(&db, None, &map, track, tier)
                .await
                .unwrap();
        }
        // Draft: badges T3 is worth 200; gabe holds its WR. ricochet, 10% slower: 100 + 100 × (30/33)^4 = 168.3,
        // plus arcane T1 at the WR, 50. Bonuses count apart: arcane's T2 bonus is worth 25.
        let (top, _) = lists(&db, "").await;
        assert_eq!(top, [row("ricochet", 1, 218, 2), row("gabe", 2, 200, 1)]);
        standings::tests::assert_totals_current(&db).await;
        let (top, completed) = lists(&db, "track=bonuses").await;
        assert_eq!(top, [row("ricochet", 1, 25, 1)]);
        assert_eq!(completed, top);

        // A new WR on arcane lowers ricochet's speed points there: 25 + 25 × (18/20)^4 = 41.4.
        submit(&db, &key, "e", "bhop_arcane", 0, 18.0, false).await;
        let (top, _) = lists(&db, "").await;
        assert_eq!(top, [row("gabe", 1, 250, 2), row("ricochet", 2, 210, 2)]);
        standings::tests::assert_totals_current(&db).await;

        // Taking that run off the boards gives the points back.
        let run_id: i64 = sqlx::query_scalar("SELECT id FROM runs WHERE server_run_id = 'e'")
            .fetch_one(&db)
            .await
            .unwrap();
        staff::runs::invalidate_run(&db, None, run_id, None)
            .await
            .unwrap();
        let (top, completed) = lists(&db, "").await;
        assert_eq!(top, [row("ricochet", 1, 218, 2), row("gabe", 2, 200, 1)]);
        assert_eq!(completed[1], row("gabe", 2, 200, 1));
        standings::tests::assert_totals_current(&db).await;

        // A recount from scratch agrees with the recounts as they happened.
        let mut tx = db.begin().await.unwrap();
        standings::refresh_all(&mut tx).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(lists(&db, "").await.0, top);
        assert_eq!(
            test_client::get(&db, "/v1/leaderboards?limit=0")
                .await
                .status,
            422
        );
        assert_eq!(
            test_client::get(&db, "/v1/leaderboards?track=both")
                .await
                .status,
            400
        );
    }

    #[sqlx::test]
    async fn players_shown_with_equal_points_share_a_rank(db: PgPool) {
        setup(&db).await;
        // 10.4 and 9.6 both show as 10; 8.6 shows as 9.
        sqlx::raw_sql(
            "INSERT INTO players (steamid64, name, name_seen_at) VALUES
                 (76561197960287940, 'alice', now()), (76561197960287941, 'bob', now()),
                 (76561197960287942, 'carol', now());
             INSERT INTO standings (style, bonus, player_steamid64, points, completed) VALUES
                 ('normal', false, 76561197960287940, 10.4, 1), ('normal', false, 76561197960287941, 9.6, 1),
                 ('normal', false, 76561197960287942, 8.6, 1);",
        )
        .execute(&db)
        .await
        .unwrap();

        let (top, _) = lists(&db, "style=normal").await;
        assert_eq!(
            top,
            [
                row("alice", 1, 10, 1),
                row("bob", 1, 10, 1),
                row("carol", 3, 9, 1)
            ]
        );
        let full: serde_json::Value = test_client::get(&db, "/v1/leaderboards/points?style=normal")
            .await
            .json();
        let ranks: Vec<_> = full["standings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["rank"].as_i64().unwrap())
            .collect();
        assert_eq!(ranks, [1, 1, 3]);
    }

    /// Two legacy maps, one tiered, and three players: gabe, alice, and a cheat whose records ban ends at
    /// `cheat_ban_ends` (SQL).
    async fn legacy_board_with_a_cheat(db: &PgPool, cheat_ban_ends: &str) {
        setup(db).await;
        // Only ever this test file's own SQL in `cheat_ban_ends`.
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO legacy_maps (id, name, tier, points) VALUES (1, 'bhop_badges', 2, 0), (2, 'bhop_old', NULL, 0);
             INSERT INTO legacy_players (steamid64, name) VALUES
                 (76561197960287930, 'gabe'), (76561197960287940, 'alice'), (76561197960287941, 'cheat');
             INSERT INTO legacy_runs
                 (id, map_id, player_steamid64, player_name, server_hostname, time, sync, strafes, jumps,
                  finished_at, initial_record)
             VALUES (1, 1, 76561197960287930, 'gabe', 's', 32, 90, 1, 1, '2020-01-01', false),
                    (2, 1, 76561197960287940, 'alice', 's', 25, 90, 1, 1, '2020-01-02', false),
                    (3, 1, 76561197960287941, 'cheat', 's', 20, 90, 1, 1, NULL, false),
                    (4, 2, 76561197960287940, 'alice', 's', 40, 90, 1, 1, '2020-01-03', false);
             INSERT INTO players (steamid64, name, name_seen_at) VALUES (76561197960287941, 'cheat', '-infinity');
             WITH entry AS (
                 INSERT INTO staff_log (action, target, reason) VALUES ('ban_player', '76561197960287941', 'x')
                 RETURNING id
             )
             INSERT INTO bans (player_steamid64, restrictions, reason, ends_at, log_id)
             SELECT 76561197960287941, 1, 'x', {cheat_ban_ends}, id FROM entry;",
        )))
        .execute(db)
        .await
        .unwrap();
    }

    #[sqlx::test]
    async fn the_legacy_view_leaves_banned_players_out(db: PgPool) {
        legacy_board_with_a_cheat(&db, "NULL").await;
        standings::refresh_legacy(&mut db.acquire().await.unwrap())
            .await
            .unwrap();

        // The cheat's 20 s sets no WR: alice's 25 s on the T2 map is worth all of 100; gabe gets
        // 50 + 50 × (25/32)^4 = 68.6. The untiered map counts as completed but earns nothing.
        let (top, completed) = lists(&db, "view=legacy").await;
        assert_eq!(top, [row("alice", 1, 100, 2), row("gabe", 2, 69, 1)]);
        assert_eq!(completed, top);

        // The full lists page through the same stored places.
        for ranking in ["points", "completed"] {
            let path = format!("/v1/leaderboards/{ranking}?view=legacy&limit=1&offset=1");
            let page: serde_json::Value = test_client::get(&db, &path).await.json();
            assert_eq!(page["total"], 2, "{ranking}");
            let second = &page["standings"][0];
            assert_eq!(
                (&second["player"]["name"], &second["rank"]),
                (&json!("gabe"), &json!(2)),
                "{ranking}"
            );
        }
    }

    #[sqlx::test]
    async fn a_timed_ban_that_ends_puts_the_player_back_on_the_legacy_view(db: PgPool) {
        legacy_board_with_a_cheat(&db, "now() + interval '1 second'").await;
        standings::refresh_legacy(&mut db.acquire().await.unwrap())
            .await
            .unwrap();
        assert!(!standings::refresh_legacy_if_bans_ended(&db).await.unwrap());
        assert_eq!(lists(&db, "view=legacy").await.0.len(), 2);

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        assert!(standings::refresh_legacy_if_bans_ended(&db).await.unwrap());
        // Their 20 s is the record again: all of 100, and alice's 25 s drops to 50 + 50 × (20/25)^4 = 70.5.
        let (top, _) = lists(&db, "view=legacy").await;
        assert_eq!(
            top,
            [
                row("cheat", 1, 100, 1),
                row("alice", 2, 70, 2),
                row("gabe", 3, 58, 1)
            ]
        );
        assert!(
            !standings::refresh_legacy_if_bans_ended(&db).await.unwrap(),
            "counted once"
        );
    }
}
