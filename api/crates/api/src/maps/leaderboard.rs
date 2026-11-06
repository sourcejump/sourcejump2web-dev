//! A map's leaderboards: ranked personal bests per style and track. `GET /v1/maps/{map}/leaderboard` pages
//! through one with a cursor; the map's own endpoint carries the top of each. The legacy board (normal, main
//! track) also has the "2.0 + pre-2.0" and "Pre-2.0" views (`legacy.rs`). Game servers read it too, for `/wr`:
//! `player` finds one player's place without paging to it.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};

use super::{MapName, check_page};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    legacy::{self, View},
    players::{PlayerRef, SteamId64},
    replays::current_policy,
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct LeaderboardQuery {
    /// Style key.
    style: String,
    /// 0 is the main track (the default), 1 and up are bonuses.
    track: Option<i16>,
    /// 1 to 100. Default 50.
    limit: Option<i64>,
    /// Continue after this point: a `next_cursor` from an earlier page of the same view. Leave out for the top.
    cursor: Option<String>,
    /// Which runs to show. Views other than `current` exist only on the normal style's main track.
    #[param(inline)]
    view: Option<View>,
    /// A player, in any `SteamID` form, whose personal best comes back as `player_entry` whichever page it's on.
    player: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Leaderboard {
    pub map: String,
    pub style: String,
    pub track: i16,
    /// Personal bests on this leaderboard, across all pages.
    pub total: i64,
    /// The 2.0 record time, in every view. None when nobody has a 2.0 run here.
    pub world_record_time: Option<f64>,
    /// The fastest time in this view, so any page can show each entry's gap to it: the record time for 2.0
    /// runs alone, possibly a legacy run's in the other views. None on an empty leaderboard.
    pub fastest_time: Option<f64>,
    /// Fastest first. Equal times share a rank; the earlier run is listed first.
    pub entries: Vec<LeaderboardEntry>,
    /// Pass as `cursor` for the entries after these. None at the end.
    pub next_cursor: Option<String>,
    /// The `player` asked for: their personal best on this leaderboard, with its rank. None when they have
    /// none, or no `player` was asked for. Only in the `current` view.
    pub player_entry: Option<LeaderboardEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LeaderboardEntry {
    /// Placement in this view. Equal times share it.
    pub rank: i64,
    pub player: PlayerRef,
    /// Seconds.
    pub time: f64,
    /// A legacy run from the old site. Its `run_id` is then the old site's, and it has no run page.
    pub legacy: bool,
    pub run_id: i64,
    /// None only for a few legacy runs whose date the old site stored unreadably.
    pub finished_at: Option<DateTime<Utc>>,
    pub jumps: i32,
    pub strafes: i32,
    /// Percent, 0–100.
    pub sync: f32,
    /// What this personal best earns (`docs/site-api.md`); 0 on an untiered track and for legacy runs.
    pub points: f64,
    /// Whether `GET /v1/replays/{run_id}` serves this run's replay: it's stored and its style's replays are
    /// public. Always false for legacy runs.
    pub has_replay: bool,
}

/// An entry with the leaderboard it's on.
pub(super) struct BoardEntry {
    pub style: String,
    pub track: i16,
    pub entry: LeaderboardEntry,
}

/// Where a page of a leaderboard starts: after the entry with this time, finish time and run.
type Position = (f64, DateTime<Utc>, i64);

/// Where a page of a view with legacy runs starts: time, finish time (None sorts last), whether legacy, run.
type ViewPosition = (f64, Option<DateTime<Utc>>, bool, i64);

/// Older cursors at a legacy run carried this before its ID, since the old site's IDs overlap 2.0's.
const LEGACY_CURSOR: &str = "pre-";

/// A cursor names the place on the board where the page ended, not the entry there: a player who improves
/// while a server pages through the board takes their old personal best away, and paging must still go on
/// from where it was. The time is written as its exact bits, so the next page starts exactly after it.
fn cursor(entry: &LeaderboardEntry) -> String {
    let kind = if entry.legacy { 'l' } else { 'r' };
    let finished_at = entry
        .finished_at
        .map(|at| at.timestamp_micros().to_string())
        .unwrap_or_default();
    format!(
        "{kind}{:016x}.{finished_at}.{}",
        entry.time.to_bits(),
        entry.run_id
    )
}

/// The place a `cursor` names. None for anything else, including the older cursors that named a run.
fn parse_cursor(cursor: &str) -> Option<ViewPosition> {
    let (kind, rest) = cursor.split_at_checked(1)?;
    let legacy = match kind {
        "l" => true,
        "r" => false,
        _ => return None,
    };
    let mut parts = rest.split('.');
    let time = f64::from_bits(u64::from_str_radix(parts.next()?, 16).ok()?);
    let finished_at = match parts.next()? {
        "" => None,
        micros => Some(DateTime::from_timestamp_micros(micros.parse().ok()?)?),
    };
    let id = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !time.is_finite() {
        return None;
    }
    Some((time, finished_at, legacy, id))
}

/// Ranked entries of a map's leaderboards, each board in order: fastest first, and on equal times the
/// earlier run first. `board` narrows to one style and track, `after` continues after a position, and at
/// most `per_board` entries come from each board.
pub(super) async fn entries(
    db: &PgPool,
    map_id: i64,
    board: Option<(&str, i16)>,
    after: Option<Position>,
    per_board: i64,
) -> Result<Vec<BoardEntry>, sqlx::Error> {
    // Each board's page is read in order straight off `personal_bests_board`, so a page costs the same on a
    // board of ten players as on one of a hundred thousand. Places come from two counts on that index: how
    // many are faster than the page's first time (that time's place, which it may share with entries on the
    // page before), and how many come before the page (the start for every slower time on it).
    let rows = sqlx::query!(
        r#"
        WITH RECURSIVE every_board AS (
            -- Each style and track with a personal best on the map, one index probe apiece.
            (SELECT style, track FROM personal_bests WHERE map_id = $1 ORDER BY map_id, style, track LIMIT 1)
            UNION ALL
            SELECT next.style, next.track
            FROM every_board b
            CROSS JOIN LATERAL (
                SELECT style, track FROM personal_bests
                WHERE map_id = $1 AND (style, track) > (b.style, b.track)
                ORDER BY map_id, style, track LIMIT 1
            ) next
        ), boards AS (
            SELECT $2::text AS style, $3::smallint AS track WHERE $2::text IS NOT NULL
            UNION ALL
            SELECT style, track FROM every_board WHERE $2::text IS NULL
        ), page AS (
            SELECT pb.style, pb.track, pb.player_steamid64, pb.time, pb.finished_at, pb.run_id,
                   rank() OVER board AS page_rank, min(pb.time) OVER board AS first_time
            FROM boards b
            CROSS JOIN LATERAL (
                SELECT * FROM personal_bests pb
                WHERE pb.map_id = $1 AND pb.style = b.style AND pb.track = b.track
                  AND ($4::float8 IS NULL
                       OR (pb.time, pb.finished_at, pb.run_id) > ($4, $5::timestamptz, $6::bigint))
                ORDER BY pb.time, pb.finished_at, pb.run_id
                LIMIT $7
            ) pb
            WINDOW board AS (PARTITION BY pb.style, pb.track ORDER BY pb.time)
        ), ahead AS MATERIALIZED (
            -- Materialized so each board counts once, not once per entry.
            SELECT b.style, b.track,
                   (SELECT count(*) FROM personal_bests x
                    WHERE x.map_id = $1 AND x.style = b.style AND x.track = b.track
                      AND x.time < b.first_time) AS faster_than_first,
                   -- Without a cursor the comparison is null, so nothing comes before the page.
                   (SELECT count(*) FROM personal_bests x
                    WHERE x.map_id = $1 AND x.style = b.style AND x.track = b.track
                      AND (x.time, x.finished_at, x.run_id) <= ($4, $5, $6)) AS before_page
            FROM (SELECT DISTINCT style, track, first_time FROM page) b
        )
        SELECT p.style, p.track, p.time, p.run_id, p.finished_at,
               CASE WHEN p.time = p.first_time THEN a.faster_than_first + 1
                    ELSE a.before_page + p.page_rank END AS "rank!",
               r.jumps, r.strafes, r.sync, personal_best_points($1, p.style, p.track, p.time) AS "points!",
               rp.stored_key IS NOT NULL AS "stored!",
               pl.steamid64::text AS "steamid64!", pl.name, pl.avatar_url, pl.country_code
        FROM page p
        JOIN ahead a ON a.style = p.style AND a.track = p.track
        JOIN runs r ON r.id = p.run_id
        JOIN players pl ON pl.steamid64 = p.player_steamid64
        LEFT JOIN replays rp ON rp.run_id = p.run_id
        ORDER BY p.style, p.track, p.time, p.finished_at, p.run_id
        "#,
        map_id,
        board.map(|(style, _)| style),
        board.map(|(_, track)| track),
        after.map(|(time, _, _)| time),
        after.map(|(_, finished_at, _)| finished_at),
        after.map(|(_, _, run_id)| run_id),
        per_board
    )
    .fetch_all(db)
    .await?;
    let policy = current_policy(&mut *db.acquire().await?).await?;

    Ok(rows
        .into_iter()
        .map(|row| BoardEntry {
            entry: LeaderboardEntry {
                has_replay: row.stored && policy.is_public(&row.style),
                rank: row.rank,
                player: PlayerRef {
                    steamid64: row.steamid64,
                    name: row.name,
                    avatar_url: row.avatar_url,
                    country_code: row.country_code,
                },
                time: row.time,
                legacy: false,
                run_id: row.run_id,
                finished_at: Some(row.finished_at),
                jumps: row.jumps,
                strafes: row.strafes,
                sync: row.sync,
                points: row.points,
            },
            style: row.style,
            track: row.track,
        })
        .collect())
}

/// Keeps the first `limit` entries and says where the next page starts, if there is one. Callers fetch
/// one entry more than they show to find out.
pub(super) fn split_page(
    mut entries: Vec<LeaderboardEntry>,
    limit: usize,
) -> (Vec<LeaderboardEntry>, Option<String>) {
    if entries.len() <= limit {
        return (entries, None);
    }
    entries.truncate(limit);
    let next = entries.last().map(cursor);
    (entries, next)
}

/// The map's personal bests for one style and track, ranked, a page at a time. An unknown map is a 404;
/// a style or track nobody has finished is an empty leaderboard.
#[utoipa::path(
    get,
    path = "/v1/maps/{map}/leaderboard",
    tag = "maps",
    params(("map" = String, Path, description = "Map name"), LeaderboardQuery),
    responses(
        (status = OK, body = Leaderboard),
        (status = NOT_FOUND, description = "SourceJump has no such map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name, track, limit or cursor", body = ErrorBody),
    ),
)]
pub async fn map_leaderboard(
    State(state): State<AppState>,
    Path(map): Path<String>,
    Query(query): Query<LeaderboardQuery>,
) -> Result<Json<Leaderboard>, ApiError> {
    let map = MapName::try_from(map).map_err(ApiError::Invalid)?;
    let track = query.track.unwrap_or(0);
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    check_page(limit, 0, MAX_LIMIT).map_err(ApiError::Invalid)?;
    if track < 0 {
        return Err(ApiError::Invalid("track can't be negative".to_owned()));
    }

    let view = query.view.unwrap_or_default();
    view.check_board(&query.style, track)
        .map_err(ApiError::Invalid)?;
    let limit_usize = usize::try_from(limit).expect("checked to be positive");

    let map_id = sqlx::query_scalar!("SELECT id FROM maps WHERE name = $1", map.as_str())
        .fetch_optional(&state.db)
        .await?;
    if view != View::Current {
        let mut page = view_page(
            &state.db,
            &map,
            map_id,
            view,
            query.cursor.as_deref(),
            limit,
        )
        .await?;
        let public = current_policy(&mut *state.db.acquire().await?)
            .await?
            .is_public(legacy::STYLE);
        for entry in &mut page.entries {
            entry.has_replay &= public;
        }
        let (entries, next_cursor) = split_page(page.entries, limit_usize);
        return Ok(Json(Leaderboard {
            map: map.into(),
            style: query.style,
            track,
            total: page.total,
            world_record_time: page.world_record_time,
            fastest_time: page.fastest_time,
            entries,
            next_cursor,
            player_entry: None,
        }));
    }
    let map_id = map_id.ok_or(ApiError::NotFound("SourceJump has no such map"))?;
    let player = match &query.player {
        None => None,
        Some(player) => Some(
            SteamId64::parse_any(player)
                .ok_or_else(|| ApiError::Invalid("player isn't a SteamID".to_owned()))?,
        ),
    };

    let after = match &query.cursor {
        None => None,
        Some(cursor) => Some(position(&state.db, map_id, &query.style, track, cursor).await?),
    };

    let summary = sqlx::query!(
        r#"SELECT count(*) AS "total!", min(time) AS world_record_time
           FROM personal_bests WHERE map_id = $1 AND style = $2 AND track = $3"#,
        map_id,
        query.style,
        track
    )
    .fetch_one(&state.db)
    .await?;

    let rows = entries(
        &state.db,
        map_id,
        Some((&query.style, track)),
        after,
        limit + 1,
    )
    .await?;
    let (entries, next_cursor) =
        split_page(rows.into_iter().map(|row| row.entry).collect(), limit_usize);
    let player_entry = match player {
        None => None,
        Some(player) => player_entry(&state.db, map_id, &query.style, track, player).await?,
    };

    Ok(Json(Leaderboard {
        map: map.into(),
        style: query.style,
        track,
        total: summary.total,
        world_record_time: summary.world_record_time,
        fastest_time: summary.world_record_time,
        entries,
        next_cursor,
        player_entry,
    }))
}

/// One player's personal best on a leaderboard, ranked. It's read as a one-entry page starting right after
/// the entry before it, so it's built, ranked and replay-checked exactly as on the board.
async fn player_entry(
    db: &PgPool,
    map_id: i64,
    style: &str,
    track: i16,
    player: SteamId64,
) -> Result<Option<LeaderboardEntry>, sqlx::Error> {
    let found = sqlx::query!(
        r#"SELECT (SELECT ROW(x.time, x.finished_at, x.run_id) FROM personal_bests x
                   WHERE x.map_id = pb.map_id AND x.style = pb.style AND x.track = pb.track
                     AND (x.time, x.finished_at, x.run_id) < (pb.time, pb.finished_at, pb.run_id)
                   ORDER BY x.time DESC, x.finished_at DESC, x.run_id DESC LIMIT 1)
                  AS "before: (f64, DateTime<Utc>, i64)"
           FROM personal_bests pb
           WHERE pb.map_id = $1 AND pb.style = $2 AND pb.track = $3 AND pb.player_steamid64 = $4"#,
        map_id,
        style,
        track,
        player.get()
    )
    .fetch_optional(db)
    .await?;
    let Some(found) = found else { return Ok(None) };
    let rows = entries(db, map_id, Some((style, track)), found.before, 1).await?;
    Ok(rows.into_iter().next().map(|row| row.entry))
}

/// A page of a view with legacy runs, one entry more than `limit` when there's more.
struct ViewPage {
    entries: Vec<LeaderboardEntry>,
    total: i64,
    world_record_time: Option<f64>,
    fastest_time: Option<f64>,
}

/// The legacy board's "2.0 + pre-2.0" or "Pre-2.0" view. A map SourceJump knows only from legacy records
/// has this board alone; a map known to neither is a 404.
///
/// Players banned from records are left out of the legacy runs, as the old site hid them; their 2.0 runs
/// are already off the boards.
#[expect(
    clippy::too_many_lines,
    reason = "one query over both kinds of run, and its rows; split, the view's rules would sit in two places"
)]
async fn view_page(
    db: &PgPool,
    map: &MapName,
    map_id: Option<i64>,
    view: View,
    cursor: Option<&str>,
    limit: i64,
) -> Result<ViewPage, ApiError> {
    if map_id.is_none() && legacy::board_players(db, map.as_str()).await?.is_none() {
        return Err(ApiError::NotFound("SourceJump has no such map"));
    }
    let after = match cursor {
        None => None,
        Some(cursor) => Some(view_position(db, map, map_id, cursor).await?),
    };
    let world_record_time = sqlx::query_scalar!(
        "SELECT min(time) FROM personal_bests WHERE map_id = $1 AND style = $2 AND track = $3",
        map_id,
        legacy::STYLE,
        legacy::TRACK
    )
    .fetch_one(db)
    .await?;

    // Undated legacy runs sort after dated ones of the same time; `infinity` stands in for their date.
    let rows = sqlx::query!(
        r#"
        WITH board AS (
            SELECT DISTINCT ON (player) * FROM (
                SELECT false AS legacy, pb.player_steamid64 AS player, pb.time, r.finished_at,
                       pb.run_id AS id, r.jumps, r.strafes, r.sync,
                       personal_best_points(pb.map_id, pb.style, pb.track, pb.time) AS points,
                       rp.stored_key IS NOT NULL AS stored
                FROM personal_bests pb
                JOIN runs r ON r.id = pb.run_id
                LEFT JOIN replays rp ON rp.run_id = pb.run_id
                WHERE $3 AND pb.map_id = $1 AND pb.style = $9 AND pb.track = $10
                UNION ALL
                SELECT true, l.player_steamid64, l.time, l.finished_at, l.id::bigint, l.jumps, l.strafes, l.sync, 0, false
                FROM legacy_personal_bests l
                -- By ID, not a join on name, so the view picks bests on this map alone, not across all runs.
                WHERE l.map_id = (SELECT id FROM legacy_maps WHERE name = $2) AND NOT EXISTS (
                    SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64
                )
            ) both_kinds
            -- Each player's fastest run of either kind; on equal times, their 2.0 run.
            ORDER BY player, time, legacy
        ), ranked AS (
            SELECT *, rank() OVER (ORDER BY time) AS rank, count(*) OVER () AS total,
                   min(time) OVER () AS fastest, coalesce(finished_at, 'infinity') AS sort_at
            FROM board
        )
        SELECT ranked.legacy AS "legacy!", ranked.time AS "time!", ranked.finished_at, ranked.id AS "id!",
               ranked.jumps AS "jumps!", ranked.strafes AS "strafes!", ranked.sync AS "sync!",
               ranked.points AS "points!", ranked.stored AS "stored!",
               ranked.rank AS "rank!", ranked.total AS "total!", ranked.fastest AS "fastest!",
               ranked.player::text AS "steamid64!", coalesce(p.name, lp.name) AS "name!",
               coalesce(p.avatar_url, lp.avatar_url) AS avatar_url,
               coalesce(p.country_code, lp.country_code) AS country_code
        FROM ranked
        LEFT JOIN players p ON p.steamid64 = ranked.player
        LEFT JOIN legacy_players lp ON lp.steamid64 = ranked.player
        WHERE $4::float8 IS NULL
           OR (ranked.time, ranked.sort_at, ranked.legacy, ranked.id)
              > ($4, coalesce($5::timestamptz, 'infinity'), $6::bool, $7::bigint)
        ORDER BY ranked.time, ranked.sort_at, ranked.legacy, ranked.id
        LIMIT $8
        "#,
        map_id,
        map.as_str(),
        view == View::All,
        after.map(|(time, _, _, _)| time),
        after.and_then(|(_, finished_at, _, _)| finished_at),
        after.map(|(_, _, legacy, _)| legacy),
        after.map(|(_, _, _, id)| id),
        limit + 1,
        legacy::STYLE,
        legacy::TRACK
    )
    .fetch_all(db)
    .await?;

    // The totals ride on every row. A page past the end has none, which only a board that shrank between
    // pages can produce; it then reads as empty.
    let (total, fastest_time) = rows
        .first()
        .map_or((0, None), |row| (row.total, Some(row.fastest)));
    let entries = rows
        .into_iter()
        .map(|row| LeaderboardEntry {
            rank: row.rank,
            player: PlayerRef {
                steamid64: row.steamid64,
                name: row.name,
                avatar_url: row.avatar_url,
                country_code: row.country_code,
            },
            time: row.time,
            legacy: row.legacy,
            run_id: row.id,
            finished_at: row.finished_at,
            jumps: row.jumps,
            strafes: row.strafes,
            sync: row.sync,
            points: row.points,
            // Narrowed by the replays policy in `map_leaderboard`.
            has_replay: row.stored,
        })
        .collect();
    Ok(ViewPage {
        entries,
        total,
        world_record_time,
        fastest_time,
    })
}

/// Where a view's cursor points. An older cursor names a 2.0 personal best on the legacy board, or a legacy
/// run on this map.
async fn view_position(
    db: &PgPool,
    map: &MapName,
    map_id: Option<i64>,
    cursor: &str,
) -> Result<ViewPosition, ApiError> {
    if let Some(position) = parse_cursor(cursor) {
        return Ok(position);
    }
    let invalid = || ApiError::Invalid("that cursor isn't from this leaderboard".to_owned());
    if let Some(id) = cursor.strip_prefix(LEGACY_CURSOR) {
        let id: i32 = id.parse().map_err(|_| invalid())?;
        let found = sqlx::query!(
            "SELECT r.time, r.finished_at FROM legacy_runs r JOIN legacy_maps m ON m.id = r.map_id
             WHERE r.id = $1 AND m.name = $2",
            id,
            map.as_str()
        )
        .fetch_optional(db)
        .await?
        .ok_or_else(invalid)?;
        return Ok((found.time, found.finished_at, true, i64::from(id)));
    }
    let map_id = map_id.ok_or_else(invalid)?;
    let (time, finished_at, run_id) =
        position(db, map_id, legacy::STYLE, legacy::TRACK, cursor).await?;
    Ok((time, Some(finished_at), false, run_id))
}

/// Where a cursor points on a board of 2.0 runs. An older cursor is a run ID, accepted while it's still a
/// personal best on this leaderboard, so clients holding one can finish paging after an update.
async fn position(
    db: &PgPool,
    map_id: i64,
    style: &str,
    track: i16,
    cursor: &str,
) -> Result<Position, ApiError> {
    let invalid = || ApiError::Invalid("that cursor isn't from this leaderboard".to_owned());
    if let Some(position) = parse_cursor(cursor) {
        return match position {
            (time, Some(finished_at), false, run_id) => Ok((time, finished_at, run_id)),
            _ => Err(invalid()),
        };
    }
    let run_id: i64 = cursor.parse().map_err(|_| invalid())?;
    let found = sqlx::query!(
        r#"SELECT pb.time, pb.finished_at FROM personal_bests pb
           WHERE pb.run_id = $1 AND pb.map_id = $2 AND pb.style = $3 AND pb.track = $4"#,
        run_id,
        map_id,
        style,
        track
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(invalid)?;
    Ok((found.time, found.finished_at, run_id))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use chrono::DateTime;

    use super::{Leaderboard, LeaderboardEntry, cursor, parse_cursor};
    use crate::{
        players::PlayerRef,
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn ranks_and_pages_personal_bests(db: PgPool) {
        let key = setup(&db).await;
        let players = [
            ("76561197960287931", 29.0, 1_792_500_000),
            ("76561197960287932", 29.0, 1_792_450_000),
            ("76561197960287933", 35.0, 1_792_400_000),
        ];
        for (index, (steamid64, time, finished_at)) in players.into_iter().enumerate() {
            let mut body = run(&format!("p{index}"), time);
            body["player"] = json!({ "steamid64": steamid64, "name": format!("p{index}") });
            body["finished_at"] = json!(finished_at);
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;

        let board: Leaderboard =
            test_client::get(&db, "/v1/maps/bhop_badges/leaderboard?style=normal")
                .await
                .json();

        assert_eq!(board.total, 4);
        assert_eq!(board.world_record_time, Some(29.0));
        let places: Vec<_> = board
            .entries
            .iter()
            .map(|e| (e.rank, e.player.name.as_str()))
            .collect();
        // Equal times share a rank, and the one set first is listed first.
        assert_eq!(places, [(1, "p1"), (1, "p0"), (3, "gabe"), (4, "p2")]);

        let first_page: Leaderboard =
            test_client::get(&db, "/v1/maps/bhop_badges/leaderboard?style=normal&limit=2")
                .await
                .json();
        let cursor = first_page.next_cursor.expect("two more entries");
        let second_page: Leaderboard = test_client::get(
            &db,
            &format!("/v1/maps/bhop_badges/leaderboard?style=normal&limit=2&cursor={cursor}"),
        )
        .await
        .json();
        let places: Vec<_> = second_page
            .entries
            .iter()
            .map(|e| (e.rank, e.player.name.as_str()))
            .collect();
        assert_eq!(places, [(3, "gabe"), (4, "p2")]);
        assert_eq!(second_page.next_cursor, None);
        assert_eq!(second_page.world_record_time, Some(29.0));
    }

    #[sqlx::test]
    async fn finds_one_players_place_whichever_page_it_is_on(db: PgPool) {
        let key = setup(&db).await;
        let players = [
            ("76561197960287931", 29.0),
            ("76561197960287932", 29.0),
            ("76561197960287933", 35.0),
        ];
        for (index, (steamid64, time)) in players.into_iter().enumerate() {
            let mut body = run(&format!("p{index}"), time);
            body["player"] = json!({ "steamid64": steamid64, "name": format!("p{index}") });
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }

        let page = |player: &'static str| {
            let db = db.clone();
            async move {
                let board: Leaderboard = test_client::get(
                    &db,
                    &format!(
                        "/v1/maps/bhop_badges/leaderboard?style=normal&limit=1&player={player}"
                    ),
                )
                .await
                .json();
                board
                    .player_entry
                    .map(|e| (e.rank, e.player.name, e.has_replay))
            }
        };
        assert_eq!(
            page("76561197960287933").await,
            Some((3, "p2".to_owned(), false))
        );
        // A shared place reads as shared, and SteamID2 works like on the profile.
        assert_eq!(
            page("STEAM_0:1:11101").await,
            Some((1, "p0".to_owned(), false))
        );
        assert_eq!(page("76561197960287939").await, None);
        let bad = test_client::get(
            &db,
            "/v1/maps/bhop_badges/leaderboard?style=normal&player=x",
        )
        .await;
        assert_eq!(bad.status, 422);
    }

    #[sqlx::test]
    async fn a_shared_place_carries_onto_the_next_page(db: PgPool) {
        let key = setup(&db).await;
        let players = [
            ("76561197960287931", 29.0, 1_792_400_000),
            ("76561197960287932", 29.0, 1_792_450_000),
            ("76561197960287933", 29.0, 1_792_500_000),
            ("76561197960287934", 31.0, 1_792_400_000),
        ];
        for (index, (steamid64, time, finished_at)) in players.into_iter().enumerate() {
            let mut body = run(&format!("p{index}"), time);
            body["player"] = json!({ "steamid64": steamid64, "name": format!("p{index}") });
            body["finished_at"] = json!(finished_at);
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }

        let first_page: Leaderboard =
            test_client::get(&db, "/v1/maps/bhop_badges/leaderboard?style=normal&limit=2")
                .await
                .json();
        let cursor = first_page.next_cursor.expect("two more entries");
        let second_page: Leaderboard = test_client::get(
            &db,
            &format!("/v1/maps/bhop_badges/leaderboard?style=normal&limit=2&cursor={cursor}"),
        )
        .await
        .json();
        let places: Vec<_> = second_page
            .entries
            .iter()
            .map(|e| (e.rank, e.player.name.as_str()))
            .collect();
        assert_eq!(places, [(1, "p2"), (4, "p3")]);
    }

    #[sqlx::test]
    async fn paging_goes_on_after_the_player_at_the_cursor_improves(db: PgPool) {
        let key = setup(&db).await;
        let players = [
            ("76561197960287931", 29.0),
            ("76561197960287932", 31.0),
            ("76561197960287933", 35.0),
        ];
        for (index, (steamid64, time)) in players.into_iter().enumerate() {
            let mut body = run(&format!("p{index}"), time);
            body["player"] = json!({ "steamid64": steamid64, "name": format!("p{index}") });
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }
        let first_page: Leaderboard =
            test_client::get(&db, "/v1/maps/bhop_badges/leaderboard?style=normal&limit=2")
                .await
                .json();
        let cursor = first_page.next_cursor.expect("one more entry");

        let mut faster = run("p1-again", 30.0);
        faster["player"] = json!({ "steamid64": "76561197960287932", "name": "p1" });
        test_client::post(&db, "/v1/runs", Some(&key), &faster).await;

        let second_page: Leaderboard = test_client::get(
            &db,
            &format!("/v1/maps/bhop_badges/leaderboard?style=normal&limit=2&cursor={cursor}"),
        )
        .await
        .json();
        let names: Vec<_> = second_page
            .entries
            .iter()
            .map(|e| e.player.name.as_str())
            .collect();
        assert_eq!(names, ["p2"]);
    }

    #[test]
    fn cursors_read_back_as_the_place_they_name() {
        let entry = |legacy: bool, finished_at: Option<i64>| LeaderboardEntry {
            rank: 1,
            player: PlayerRef {
                steamid64: "76561197960287930".to_owned(),
                name: "gabe".to_owned(),
                avatar_url: None,
                country_code: None,
            },
            time: 42.123_456_789,
            legacy,
            run_id: 7,
            finished_at: finished_at.and_then(DateTime::from_timestamp_micros),
            jumps: 0,
            strafes: 0,
            sync: 0.0,
            points: 0.0,
            has_replay: false,
        };
        for (legacy, finished_at) in [(false, Some(1_792_400_000_123_456)), (true, None)] {
            let entry = entry(legacy, finished_at);
            assert_eq!(
                parse_cursor(&cursor(&entry)),
                Some((entry.time, entry.finished_at, legacy, 7))
            );
        }
        assert_eq!(parse_cursor("12"), None, "an older run ID cursor");
        assert_eq!(parse_cursor("pre-12"), None);
        assert_eq!(parse_cursor("r7ff8000000000000..1"), None, "NaN");
    }

    #[sqlx::test]
    async fn empty_boards_unknown_maps_and_bad_queries(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;

        let bonus: Leaderboard =
            test_client::get(&db, "/v1/maps/bhop_badges/leaderboard?style=normal&track=1")
                .await
                .json();
        assert_eq!((bonus.total, bonus.world_record_time), (0, None));
        let get = |path: &'static str| {
            let db = db.clone();
            async move { test_client::get(&db, path).await.status }
        };
        assert_eq!(
            get("/v1/maps/bhop_none/leaderboard?style=normal").await,
            404
        );
        assert_eq!(
            get("/v1/maps/bhop_badges/leaderboard?style=normal&track=-1").await,
            422
        );
        assert_eq!(
            get("/v1/maps/bhop_badges/leaderboard?style=normal&cursor=x").await,
            422
        );
        assert_eq!(
            get("/v1/maps/bhop_badges/leaderboard?style=sw&cursor=1").await,
            422
        );
        assert_eq!(get("/v1/maps/bhop_badges/leaderboard").await, 400);
    }
}
