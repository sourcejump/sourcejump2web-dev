//! Finding players, `GET /v1/players`: by name or Steam ID, or the most recently active when no search is given.
//! Searches also find players SourceJump knows only from legacy records, by their name on the old site. Each
//! player comes with their latest run and how many runs they finished on each of the last 30 days, so the
//! Players page shows what everyone has been playing.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};

use super::{SteamId64, activity};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::{image::MapImage, tiers},
    name_search,
    storage::Storage,
};

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;
/// Days in `activity`, today included.
const ACTIVITY_DAYS: i32 = 30;

#[derive(Debug, Deserialize, IntoParams)]
pub struct PlayersQuery {
    /// Part of a name, or a Steam ID in any form. Leave out for recently active players. Names that are
    /// exactly the search come first, then names starting with it, then names containing it; near misses
    /// for a typo come last, closest first.
    q: Option<String>,
    /// 1 to 100. Default 20.
    limit: Option<i64>,
    /// Continue after this point: a `next_cursor` from an earlier page of the same list.
    cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerList {
    pub players: Vec<PlayerSummary>,
    /// Pass as `cursor` for the players after these. None at the end.
    pub next_cursor: Option<String>,
    /// How many players the whole list has: everyone the search finds, or everyone with a run in the last
    /// 30 days. A search page past the last match says 0.
    pub total: i64,
    /// Number of tiers in force; None while the community hasn't set tiers, and runs then have no tier.
    pub tier_count: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerSummary {
    /// SteamID64, as a string.
    pub steamid64: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub country_code: Option<String>,
    /// Their latest valid run. None for a player with no 2.0 runs.
    pub latest_run: Option<LatestRun>,
    /// Valid runs finished on each of the last 30 UTC days, oldest first; the last is today.
    pub activity: Vec<i32>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LatestRun {
    pub run_id: i64,
    pub map: String,
    /// The map's cover picture, if it has one.
    pub map_image: Option<MapImage>,
    pub style: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    /// The board's tier. None while tiers aren't in force or staff haven't set this board's.
    pub tier: Option<i16>,
    /// Seconds.
    pub time: f64,
    /// By the game server's clock.
    pub finished_at: DateTime<Utc>,
    /// Where the run placed on its board when it finished, as on the Activity page. None when it didn't beat
    /// the player's own best, so it never placed.
    pub placement: Option<i64>,
    /// Faster than every valid run before it on the board.
    pub world_record: bool,
    /// The player's best time on the board before this run, in seconds. None when this was their first
    /// finish there.
    pub previous_best: Option<f64>,
}

/// Who a page lists, before their latest runs and activity are added.
struct Listed {
    steamid64: String,
    name: String,
    avatar_url: Option<String>,
    country_code: Option<String>,
}

/// A listed player's latest run, as `with_runs` reads it; the run's columns are all null for a
/// player with no valid runs.
struct RunRow {
    steamid64: i64,
    run_id: Option<i64>,
    map: Option<String>,
    style: Option<String>,
    track: Option<i16>,
    tier: Option<i16>,
    time: Option<f64>,
    finished_at: Option<DateTime<Utc>>,
    world_record: Option<bool>,
    previous_best: Option<f64>,
    placement: Option<i64>,
    image_id: Option<i64>,
    image_key: Option<String>,
    image_focus: Option<i16>,
}

impl RunRow {
    fn into_latest_run(self, storage: &Storage) -> Option<LatestRun> {
        Some(LatestRun {
            run_id: self.run_id?,
            map: self.map?,
            map_image: MapImage::cover(storage, self.image_id, self.image_key, self.image_focus),
            style: self.style?,
            track: self.track?,
            tier: self.tier,
            time: self.time?,
            finished_at: self.finished_at?,
            placement: self.placement,
            world_record: self.world_record.unwrap_or(false),
            previous_best: self.previous_best,
        })
    }
}

/// Players matching a search, closest names first; or, with no search, players with runs in the last 30 days,
/// most recently active first.
#[utoipa::path(
    get,
    path = "/v1/players",
    tag = "players",
    params(PlayersQuery),
    responses(
        (status = OK, body = PlayerList),
        (status = UNPROCESSABLE_ENTITY, description = "Search too short, or limit or cursor not valid", body = ErrorBody),
    ),
)]
pub async fn list_players(
    State(state): State<AppState>,
    Query(query): Query<PlayersQuery>,
) -> Result<Json<PlayerList>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let search = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    let cursor = query.cursor.as_deref();

    // One more than a page is read, so a next page is offered only when there is one. `offset` is set for a
    // name search, whose pages are plain offsets: its order doesn't change as people play.
    let (mut listed, total, offset) = match search {
        None => {
            let after = match cursor {
                None => None,
                Some(cursor) => Some(position(&state.db, cursor).await?),
            };
            let listed = recently_active(&state.db, after, limit + 1).await?;
            (listed, recently_active_count(&state.db).await?, None)
        }
        Some(q) => match SteamId64::parse_any(q) {
            Some(steamid64) => {
                let listed = by_steamid(&state.db, steamid64).await?;
                let total = i64::try_from(listed.len()).expect("at most one player");
                (listed, total, None)
            }
            None if q.chars().count() < 2 => {
                return Err(ApiError::Invalid(
                    "search for at least 2 characters".to_owned(),
                ));
            }
            None => {
                let offset = match cursor {
                    None => 0,
                    Some(cursor) => cursor
                        .parse::<i64>()
                        .ok()
                        .filter(|offset| *offset >= 0)
                        .ok_or_else(invalid_cursor)?,
                };
                let (listed, total) = by_name(&state.db, q, offset, limit + 1).await?;
                (listed, total, Some(offset))
            }
        },
    };
    let page_size = usize::try_from(limit).expect("checked to be positive");
    let more = listed.len() > page_size;
    listed.truncate(page_size);

    let tier_count = tiers::tier_count(&state.db).await?;
    let players = with_runs(&state.db, &state.storage, listed, tier_count.is_some()).await?;
    let next_cursor = if !more {
        None
    } else if let Some(offset) = offset {
        Some((offset + limit).to_string())
    } else {
        // The recent list continues after its last player's latest run: players move up as they play, and a
        // position, unlike an offset, never shows anyone twice.
        players
            .last()
            .and_then(|player| player.latest_run.as_ref())
            .map(|run| run.run_id.to_string())
    };
    Ok(Json(PlayerList {
        players,
        next_cursor,
        total,
        tier_count,
    }))
}

fn invalid_cursor() -> ApiError {
    ApiError::Invalid("that cursor isn't from this list".to_owned())
}

/// Where a page of the recent list starts: after the player whose latest run finished then, with this ID.
type Position = (DateTime<Utc>, i64);

async fn position(db: &PgPool, cursor: &str) -> Result<Position, ApiError> {
    let run_id: i64 = cursor.parse().map_err(|_| invalid_cursor())?;
    let finished_at = sqlx::query_scalar!("SELECT finished_at FROM runs WHERE id = $1", run_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(invalid_cursor)?;
    Ok((finished_at, run_id))
}

async fn recently_active(
    db: &PgPool,
    after: Option<Position>,
    limit: i64,
) -> Result<Vec<Listed>, sqlx::Error> {
    // Each player's latest valid run in the last 30 days, ordered and paged by that run (finish time, then ID).
    sqlx::query_as!(
        Listed,
        r#"
        SELECT p.steamid64::text AS "steamid64!", p.name AS "name!", p.avatar_url, p.country_code
        FROM (
            SELECT DISTINCT ON (player_steamid64) player_steamid64, id, finished_at
            FROM runs WHERE finished_at > now() - interval '30 days' AND invalidated_at IS NULL
            ORDER BY player_steamid64, finished_at DESC, id DESC
        ) latest
        JOIN players p ON p.steamid64 = latest.player_steamid64
        WHERE $2::timestamptz IS NULL OR (latest.finished_at, latest.id) < ($2, $3::bigint)
        ORDER BY latest.finished_at DESC, latest.id DESC
        LIMIT $1
        "#,
        limit,
        after.map(|(finished_at, _)| finished_at),
        after.map(|(_, run_id)| run_id),
    )
    .fetch_all(db)
    .await
}

/// How many players `recently_active` lists in all: one probe per player for a valid run in the last 30 days.
async fn recently_active_count(db: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "total!" FROM players p
        WHERE EXISTS (
            SELECT 1 FROM runs r
            WHERE r.player_steamid64 = p.steamid64 AND r.invalidated_at IS NULL
              AND r.finished_at > now() - interval '30 days'
        )
        "#
    )
    .fetch_one(db)
    .await
}

async fn by_steamid(db: &PgPool, steamid64: SteamId64) -> Result<Vec<Listed>, sqlx::Error> {
    sqlx::query_as!(
        Listed,
        r#"
        SELECT p.steamid64::text AS "steamid64!", p.name AS "name!", p.avatar_url, p.country_code
        FROM players p WHERE p.steamid64 = $1
        UNION ALL
        SELECT lp.steamid64::text, lp.name, lp.avatar_url, lp.country_code
        FROM legacy_players lp
        WHERE lp.steamid64 = $1 AND NOT EXISTS (SELECT 1 FROM players WHERE steamid64 = $1)
        "#,
        steamid64.get()
    )
    .fetch_all(db)
    .await
}

async fn by_name(
    db: &PgPool,
    q: &str,
    offset: i64,
    limit: i64,
) -> Result<(Vec<Listed>, i64), sqlx::Error> {
    let pattern = name_search::contains_pattern(q);
    let mut tx = name_search::begin(db).await?;
    // Every match is found and ordered to take a page, so counting them alongside costs nothing more.
    let rows = sqlx::query!(
        r#"
        SELECT steamid64::text AS "steamid64!", name AS "name!", avatar_url, country_code,
               count(*) OVER () AS "total!"
        FROM (
            SELECT p.steamid64, p.name, p.avatar_url, p.country_code, (SELECT max(finished_at) FROM runs
                          WHERE player_steamid64 = p.steamid64 AND invalidated_at IS NULL) AS last_run_at
            FROM players p WHERE p.name ILIKE $1 ESCAPE '\' OR $4 <% p.name
            UNION ALL
            SELECT lp.steamid64, lp.name, lp.avatar_url, lp.country_code, NULL
            FROM legacy_players lp
            WHERE (lp.name ILIKE $1 ESCAPE '\' OR $4 <% lp.name)
              AND NOT EXISTS (SELECT 1 FROM players WHERE steamid64 = lp.steamid64)
        ) matches
        -- The closest names first: exactly the search, then starting with it, then containing it, then near
        -- misses by closeness; within each, whoever played last, then by ID so pages never overlap.
        ORDER BY CASE WHEN lower(name) = lower($3) THEN 0 WHEN starts_with(lower(name), lower($3)) THEN 1
                      WHEN name ILIKE $1 ESCAPE '\' THEN 2 ELSE 3 END,
                 CASE WHEN name NOT ILIKE $1 ESCAPE '\' THEN word_similarity($4, name) END DESC NULLS LAST,
                 last_run_at DESC NULLS LAST, name, steamid64
        LIMIT $2 OFFSET $5
        "#,
        pattern,
        limit,
        q,
        name_search::near_miss_term(q),
        offset
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let total = rows.first().map_or(0, |row| row.total);
    let players = rows
        .into_iter()
        .map(|row| Listed {
            steamid64: row.steamid64,
            name: row.name,
            avatar_url: row.avatar_url,
            country_code: row.country_code,
        })
        .collect();
    Ok((players, total))
}

/// Adds each listed player's latest valid run and their runs per day over the last 30 days (`activity.rs`),
/// in one query each for the whole page. The run's placement and `previous_best` count only the valid runs before it on its board
/// (finish time, then ID), the order `runs/recent.rs` uses for the Activity page.
async fn with_runs(
    db: &PgPool,
    storage: &Storage,
    listed: Vec<Listed>,
    tiers_in_force: bool,
) -> Result<Vec<PlayerSummary>, sqlx::Error> {
    let ids: Vec<i64> = listed
        .iter()
        .filter_map(|player| player.steamid64.parse().ok())
        .collect();
    let rows = sqlx::query_as!(
        RunRow,
        r#"
        SELECT p.id AS "steamid64!", latest.id AS "run_id?", m.name AS "map?", latest.style AS "style?",
               latest.track AS "track?", tier.tier AS "tier?", latest.time AS "time?",
               latest.finished_at AS "finished_at?", latest.was_record AS "world_record?",
               mine.best AS "previous_best?", place.placement AS "placement?",
               ci.id AS "image_id?", ci.key AS "image_key?", ci.focus AS "image_focus?"
        FROM unnest($1::bigint[]) p(id)
        LEFT JOIN LATERAL (
            SELECT r.id, r.map_id, r.style, r.track, r.time, r.finished_at, r.was_record FROM runs r
            WHERE r.player_steamid64 = p.id AND r.invalidated_at IS NULL
            ORDER BY r.finished_at DESC, r.id DESC
            LIMIT 1
        ) latest ON true
        LEFT JOIN maps m ON m.id = latest.map_id
        LEFT JOIN map_images ci ON ci.map_id = latest.map_id AND ci.position = 0
        LEFT JOIN current_map_tiers tier ON $2 AND tier.map_id = latest.map_id AND tier.track = latest.track
        LEFT JOIN LATERAL (
            SELECT min(e.time) AS best FROM runs e
            WHERE e.map_id = latest.map_id AND e.style = latest.style AND e.track = latest.track
              AND e.player_steamid64 = p.id AND e.invalidated_at IS NULL
              AND (e.finished_at, e.id) < (latest.finished_at, latest.id)
        ) mine ON true
        -- A place only for a run that beat the player's own best, counting the other players faster before it.
        LEFT JOIN LATERAL (
            SELECT 1 + count(*) AS placement FROM (
                SELECT 1 FROM runs e
                WHERE e.map_id = latest.map_id AND e.style = latest.style AND e.track = latest.track
                  AND e.invalidated_at IS NULL AND (e.finished_at, e.id) < (latest.finished_at, latest.id)
                  AND e.player_steamid64 <> p.id
                GROUP BY e.player_steamid64
                HAVING min(e.time) < latest.time
            ) faster
        ) place ON latest.id IS NOT NULL AND (mine.best IS NULL OR mine.best > latest.time)
        "#,
        &ids,
        tiers_in_force,
    )
    .fetch_all(db)
    .await?;

    let mut per_day = activity::runs_per_day(db, &ids, ACTIVITY_DAYS).await?;
    let mut found: HashMap<String, Option<LatestRun>> = rows
        .into_iter()
        .map(|row| (row.steamid64.to_string(), row.into_latest_run(storage)))
        .collect();
    Ok(listed
        .into_iter()
        .map(|player| {
            let latest_run = found.remove(&player.steamid64).flatten();
            let activity = player
                .steamid64
                .parse()
                .ok()
                .and_then(|id: i64| per_day.remove(&id))
                .unwrap_or_else(|| vec![0; ACTIVITY_DAYS as usize]);
            PlayerSummary {
                steamid64: player.steamid64,
                name: player.name,
                avatar_url: player.avatar_url,
                country_code: player.country_code,
                latest_run,
                activity,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    async fn names(db: &PgPool, path: &str) -> Vec<String> {
        let list: PlayerList = test_client::get(db, path).await.json();
        list.players.into_iter().map(|p| p.name).collect()
    }

    #[sqlx::test]
    async fn finds_players_by_name_or_steamid(db: PgPool) {
        let key = setup(&db).await;
        let mut other = run("b", 20.0);
        other["player"] = json!({ "steamid64": "76561197960287931", "name": "50%_off" });
        for body in [&run("a", 30.0), &other] {
            test_client::post(&db, "/v1/runs", Some(&key), body).await;
        }

        assert_eq!(names(&db, "/v1/players?q=GAB").await, ["gabe"]);
        assert_eq!(names(&db, "/v1/players?q=%25_").await, ["50%_off"]);
        assert_eq!(names(&db, "/v1/players?q=__").await, Vec::<String>::new());
        assert_eq!(names(&db, "/v1/players?q=%5BU:1:22202%5D").await, ["gabe"]);
        assert_eq!(test_client::get(&db, "/v1/players?q=g").await.status, 422);
    }

    #[sqlx::test]
    async fn exact_names_come_before_more_recent_players(db: PgPool) {
        let key = setup(&db).await;
        let mut later = run("b", 20.0);
        later["player"] = json!({ "steamid64": "76561197960287931", "name": "xgabe" });
        later["finished_at"] = json!(1_792_500_000);
        for body in [&run("a", 30.0), &later] {
            test_client::post(&db, "/v1/runs", Some(&key), body).await;
        }

        assert_eq!(names(&db, "/v1/players?q=Gabe").await, ["gabe", "xgabe"]);
        // A near miss comes last, and only when it's close.
        let mut cat = run("c", 25.0);
        cat["player"] = json!({ "steamid64": "76561197960287932", "name": "strafe_cat" });
        test_client::post(&db, "/v1/runs", Some(&key), &cat).await;
        assert_eq!(names(&db, "/v1/players?q=strafecat").await, ["strafe_cat"]);
        assert_eq!(names(&db, "/v1/players?q=zzz").await, Vec::<String>::new());
    }

    /// A run by `player` (a SteamID64's last digit, 0 being gabe), finishing `minutes_ago` minutes ago.
    fn run_by(id: &str, player: u8, map: &str, time: f64, minutes_ago: i64) -> serde_json::Value {
        let mut body = run(id, time);
        body["player"] = json!({ "steamid64": format!("7656119796028793{player}"), "name": format!("player{player}") });
        body["map"] = json!(map);
        body["finished_at"] = json!(chrono::Utc::now().timestamp() - minutes_ago * 60);
        body
    }

    async fn list(db: &PgPool, path: &str) -> PlayerList {
        let response = test_client::get(db, path).await;
        assert_eq!(response.status, 200);
        response.json()
    }

    #[sqlx::test]
    async fn each_player_comes_with_their_latest_run_and_activity(db: PgPool) {
        let key = setup(&db).await;
        for body in [
            run_by("a", 1, "bhop_badges", 30.0, 50),
            run_by("b", 0, "bhop_badges", 32.0, 40),
            run_by("c", 0, "bhop_badges", 29.5, 30),
            run_by("d", 1, "bhop_arcane", 12.0, 20),
        ] {
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }

        let page = list(&db, "/v1/players").await;
        let [newest, gabe] = page.players.as_slice() else {
            panic!("two players: {:?}", page.players);
        };
        // A first finish on a map with no one else: first place, a record, nothing to improve on.
        let run = newest.latest_run.as_ref().unwrap();
        assert_eq!(
            (newest.name.as_str(), run.map.as_str()),
            ("player1", "bhop_arcane")
        );
        assert_eq!(
            (run.placement, run.world_record, run.previous_best),
            (Some(1), true, None)
        );
        // Beating their own 32 s made gabe's 29.5 s the new record, ahead of player1's 30 s.
        let run = gabe.latest_run.as_ref().unwrap();
        assert_eq!(
            (run.placement, run.world_record, run.previous_best),
            (Some(1), true, Some(32.0))
        );
        assert_eq!(gabe.activity.len(), 30);
        assert_eq!(gabe.activity.iter().sum::<i32>(), 2);
        assert!(page.next_cursor.is_none());
    }

    #[sqlx::test]
    async fn pages_continue_where_the_last_one_ended(db: PgPool) {
        let key = setup(&db).await;
        for (id, player, minutes_ago) in [("a", 1, 30), ("b", 2, 20), ("c", 3, 10)] {
            let body = run_by(
                id,
                player,
                "bhop_badges",
                30.0 + f64::from(player),
                minutes_ago,
            );
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }

        let first = list(&db, "/v1/players?limit=2").await;
        let names = |page: &PlayerList| {
            page.players
                .iter()
                .map(|p| p.name.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&first), ["player3", "player2"]);
        assert_eq!(first.total, 3);
        let cursor = first.next_cursor.as_deref().unwrap();
        let second = list(&db, &format!("/v1/players?limit=2&cursor={cursor}")).await;
        assert_eq!(names(&second), ["player1"]);
        assert_eq!(second.total, 3);
        assert!(second.next_cursor.is_none());

        // A search pages by offset.
        let first = list(&db, "/v1/players?q=player&limit=2").await;
        assert_eq!(first.next_cursor.as_deref(), Some("2"));
        assert_eq!(first.total, 3);
        let second = list(&db, "/v1/players?q=player&limit=2&cursor=2").await;
        assert_eq!(names(&second), ["player1"]);
        assert_eq!(second.total, 3);
        assert_eq!(list(&db, "/v1/players?q=nobody").await.total, 0);
        assert_eq!(list(&db, "/v1/players?q=76561197960287930").await.total, 0);
        assert_eq!(
            test_client::get(&db, "/v1/players?cursor=nope")
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn lists_recently_active_players_without_a_search(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;

        assert_eq!(names(&db, "/v1/players").await, ["gabe"]);
        assert_eq!(
            test_client::get(&db, "/v1/players?limit=0").await.status,
            422
        );
    }
}
