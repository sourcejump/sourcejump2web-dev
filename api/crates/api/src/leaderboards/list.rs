//! One leaderboard in full, `GET /v1/leaderboards/{ranking}`: every player by points or by completions, a page
//! at a time, with their world records beside. `GET /v1/leaderboards` carries only the top of both.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{LeaderboardTrack, LeaderboardView, out_of, standings};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::{check_page, default_style},
    players::PlayerRef,
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

/// What a leaderboard ranks players by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Ranking {
    /// Most points first. Players without points are left off.
    Points,
    /// Most tracks completed first.
    Completed,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct LeaderboardListQuery {
    /// Default: the first style in the current ruleset.
    style: Option<String>,
    /// Default `main`.
    #[param(inline)]
    track: Option<LeaderboardTrack>,
    /// Default `current`.
    #[param(inline)]
    view: Option<LeaderboardView>,
    /// 1 to 100. Default 50.
    limit: Option<i64>,
    /// Players to skip, for paging. Default 0.
    offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LeaderboardList {
    pub ranking: Ranking,
    /// None if no ruleset is published, and for the legacy view.
    pub style: Option<String>,
    pub track: LeaderboardTrack,
    pub view: LeaderboardView,
    /// What completed tracks are counted out of.
    pub out_of: i64,
    pub points: standings::PointsFormula,
    /// Players on this leaderboard, across all pages.
    pub total: i64,
    pub standings: Vec<ListedStanding>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ListedStanding {
    /// Equal values share a rank.
    pub rank: i64,
    pub player: PlayerRef,
    /// Rounded to a whole point.
    pub points: i64,
    /// Tracks finished: maps, or bonus tracks.
    pub completed: i64,
    /// Tracks of this kind where their personal best is the fastest, in this style. None for the legacy view.
    pub world_records: Option<i64>,
}

/// A whole leaderboard, by points or completions, in one style and kind of track.
#[utoipa::path(
    get,
    path = "/v1/leaderboards/{ranking}",
    tag = "leaderboards",
    params(("ranking" = Ranking, Path), LeaderboardListQuery),
    responses(
        (status = OK, body = LeaderboardList),
        (status = UNPROCESSABLE_ENTITY, description = "Limit or offset out of range", body = ErrorBody),
    ),
)]
pub async fn leaderboard_list(
    State(state): State<AppState>,
    Path(ranking): Path<Ranking>,
    Query(query): Query<LeaderboardListQuery>,
) -> Result<Json<LeaderboardList>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    let offset = query.offset.unwrap_or(0);
    check_page(limit, offset, MAX_LIMIT).map_err(ApiError::Invalid)?;
    let view = query.view.unwrap_or(LeaderboardView::Current);
    // The legacy view is one style's main tracks, as on `GET /v1/leaderboards`.
    let (style, track) = match view {
        LeaderboardView::Current => (
            match query.style {
                Some(style) => Some(style),
                None => default_style(&state.db).await?,
            },
            query.track.unwrap_or(LeaderboardTrack::Main),
        ),
        LeaderboardView::Legacy => (None, LeaderboardTrack::Main),
    };
    let points = standings::formula(&mut *state.db.acquire().await?).await?;
    let out_of = out_of(&state.db, view, track).await?;
    let page = Page {
        by_points: ranking == Ranking::Points,
        limit,
        offset,
    };
    let (total, standings) = match view {
        LeaderboardView::Current => current(&state.db, style.as_deref(), track, page).await?,
        LeaderboardView::Legacy => legacy(&state.db, page).await?,
    };

    Ok(Json(LeaderboardList {
        ranking,
        style,
        track,
        view,
        out_of,
        points,
        total,
        standings,
    }))
}

#[derive(Clone, Copy)]
struct Page {
    by_points: bool,
    limit: i64,
    offset: i64,
}

/// A page of 2.0 standings and how many there are. Ties go by name, as on the overview. World records are
/// counted for the page's players only.
async fn current(
    db: &sqlx::PgPool,
    style: Option<&str>,
    track: LeaderboardTrack,
    page: Page,
) -> Result<(i64, Vec<ListedStanding>), sqlx::Error> {
    let bonus = track == LeaderboardTrack::Bonuses;
    let rows = sqlx::query!(
        r#"
        WITH ranked AS (
            SELECT s.player_steamid64, s.points, s.completed,
                   -- Ranked on the points shown, so players listed with equal points share a place.
                   CASE WHEN $3 THEN rank() OVER (ORDER BY round(s.points) DESC)
                        ELSE rank() OVER (ORDER BY s.completed DESC) END AS rank,
                   -- Down to the SteamID, so equal points and names keep one order from page to page.
                   row_number() OVER (ORDER BY CASE WHEN $3 THEN s.points ELSE s.completed END DESC,
                                               lower(p.name), s.player_steamid64) AS position
            FROM standings s JOIN players p ON p.steamid64 = s.player_steamid64
            WHERE s.style = $1 AND s.bonus = $2 AND (NOT $3 OR s.points > 0)
        ), page AS (
            SELECT * FROM ranked WHERE position > $4 ORDER BY position LIMIT $5
        )
        -- The total comes in every row, and alone in one row for a page past the end.
        SELECT (SELECT count(*) FROM ranked) AS "total!", page.rank AS "rank?",
               round(page.points)::int8 AS "points?", page.completed::int8 AS "completed?",
               p.steamid64::text AS "steamid64?", p.name AS "name?", p.avatar_url AS "avatar_url?",
               p.country_code AS "country_code?", records.count AS "world_records?"
        FROM (SELECT 1) one
        LEFT JOIN page ON true
        LEFT JOIN players p ON p.steamid64 = page.player_steamid64
        LEFT JOIN LATERAL (
            SELECT count(*) FROM world_record_holders h
            WHERE h.player_steamid64 = page.player_steamid64 AND h.style = $1 AND (h.track > 0) = $2
        ) records ON true
        ORDER BY page.position
        "#,
        style,
        bonus,
        page.by_points,
        page.offset,
        page.limit
    )
    .fetch_all(db)
    .await?;
    let total = rows.first().map_or(0, |row| row.total);
    let standings = rows
        .into_iter()
        .filter_map(|row| {
            Some(ListedStanding {
                rank: row.rank?,
                player: PlayerRef {
                    steamid64: row.steamid64?,
                    name: row.name?,
                    avatar_url: row.avatar_url,
                    country_code: row.country_code,
                },
                points: row.points?,
                completed: row.completed?,
                world_records: row.world_records,
            })
        })
        .collect();
    Ok((total, standings))
}

/// A page of legacy standings and how many there are, leaving out players banned from records as every
/// legacy view does. Ranks and places are stored by the recount (`standings.rs`), so only the page is read.
async fn legacy(db: &sqlx::PgPool, page: Page) -> Result<(i64, Vec<ListedStanding>), sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        WITH shown AS (
            SELECT s.player_steamid64, s.points, s.completed,
                   CASE WHEN $1 THEN s.points_rank ELSE s.completed_rank END AS rank,
                   CASE WHEN $1 THEN s.points_place ELSE s.completed_place END AS place
            FROM legacy_standings s
            WHERE (NOT $1 OR s.points > 0) AND NOT EXISTS (
                SELECT 1 FROM records_bans b WHERE b.player_steamid64 = s.player_steamid64
            )
        ), page AS (
            SELECT shown.*, p.name, p.avatar_url, p.country_code
            FROM (SELECT * FROM shown WHERE place > $2::int8 ORDER BY place LIMIT $3) shown
            JOIN legacy_players p ON p.steamid64 = shown.player_steamid64
        )
        SELECT (SELECT count(*) FROM shown) AS "total!", page.rank::int8 AS "rank?",
               round(page.points)::int8 AS "points?", page.completed::int8 AS "completed?",
               page.player_steamid64::text AS "steamid64?", page.name AS "name?",
               page.avatar_url AS "avatar_url?", page.country_code AS "country_code?"
        FROM (SELECT 1) one LEFT JOIN page ON true
        ORDER BY page.place
        "#,
        page.by_points,
        page.offset,
        page.limit
    )
    .fetch_all(db)
    .await?;
    let total = rows.first().map_or(0, |row| row.total);
    let standings = rows
        .into_iter()
        .filter_map(|row| {
            Some(ListedStanding {
                rank: row.rank?,
                player: PlayerRef {
                    steamid64: row.steamid64?,
                    name: row.name?,
                    avatar_url: row.avatar_url,
                    country_code: row.country_code,
                },
                points: row.points?,
                completed: row.completed?,
                world_records: None,
            })
        })
        .collect();
    Ok((total, standings))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::LeaderboardList;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn pages_through_completions_with_world_records(db: PgPool) {
        let key = setup(&db).await;
        let ricochet = json!({ "steamid64": "76561197960287931", "name": "ricochet" });
        let mut slower = run("b", 35.0);
        slower["player"] = ricochet.clone();
        let mut arcane = run("c", 20.0);
        arcane["map"] = json!("bhop_arcane");
        arcane["player"] = ricochet;
        for body in [&run("a", 30.0), &slower, &arcane] {
            let status = test_client::post(&db, "/v1/runs", Some(&key), body)
                .await
                .status;
            assert_eq!(status, 201);
        }

        // ricochet finished two maps and holds bhop_arcane; gabe finished one and holds bhop_badges.
        let first: LeaderboardList = test_client::get(&db, "/v1/leaderboards/completed?limit=1")
            .await
            .json();
        assert_eq!((first.total, first.out_of), (2, 2));
        let top = &first.standings[0];
        assert_eq!(
            (
                top.player.name.as_str(),
                top.rank,
                top.completed,
                top.world_records
            ),
            ("ricochet", 1, 2, Some(1))
        );
        let second: LeaderboardList =
            test_client::get(&db, "/v1/leaderboards/completed?limit=1&offset=1")
                .await
                .json();
        let next = &second.standings[0];
        assert_eq!(
            (next.player.name.as_str(), next.rank, next.world_records),
            ("gabe", 2, Some(1))
        );
        let past: LeaderboardList = test_client::get(&db, "/v1/leaderboards/completed?offset=5")
            .await
            .json();
        assert_eq!((past.total, past.standings.len()), (2, 0));
        assert_eq!(
            test_client::get(&db, "/v1/leaderboards/best").await.status,
            400
        );
    }

    #[sqlx::test]
    async fn players_tied_on_completions_and_name_keep_one_order_across_pages(db: PgPool) {
        let key = setup(&db).await;
        for (id, steamid64) in [
            ("a", "76561197960287932"),
            ("b", "76561197960287931"),
            ("c", "76561197960287933"),
        ] {
            let mut body = run(id, 30.0);
            body["player"] = json!({ "steamid64": steamid64, "name": "same" });
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }
        let mut seen = Vec::new();
        for offset in 0..3 {
            let page: LeaderboardList = test_client::get(
                &db,
                &format!("/v1/leaderboards/completed?limit=1&offset={offset}"),
            )
            .await
            .json();
            seen.push(page.standings[0].player.steamid64.clone());
        }
        assert_eq!(
            seen,
            [
                "76561197960287931",
                "76561197960287932",
                "76561197960287933"
            ]
        );
    }
}
