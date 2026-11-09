//! One map, `GET /v1/maps/{map}`: totals, and per track and style the world record, the top of the
//! leaderboard and the WR history. A map page loads it once and switches styles and tracks without asking
//! the API again (lead, 2026-10-19). A map SourceJump knows only from legacy records has a page too, with
//! no 2.0 boards and its pre-2.0 board to switch to.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

use std::collections::HashMap;

use super::{
    MapName, WorldRecord,
    leaderboard::{self, LeaderboardEntry},
    release::{Release, ReleaseDate},
    tiers,
    wr_history::{self, WrHistoryEntry},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    legacy,
    players::PlayerRef,
};

use super::{
    image::{self, MapImage},
    viewer_file::{self, ViewerFile},
};

/// Leaderboard entries per style and track that come with the map; the rest is paged.
const TOP: i64 = 25;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapDetail {
    pub name: String,
    /// Up to 10 pictures, in order; the first is the cover.
    pub images: Vec<MapImage>,
    /// Staff's description of the map, plain text.
    pub description: Option<String>,
    /// When it was released, as precisely as staff know; none when unknown.
    pub released: Option<ReleaseDate>,
    /// Who made it, as staff set it; none when unknown.
    pub mapper: Option<PlayerRef>,
    /// When SourceJump first saw the map: its first run or zone import. None for a map known only from
    /// legacy records.
    pub created_at: Option<DateTime<Utc>>,
    /// When its latest run finished. None if nobody has run it.
    pub last_run_at: Option<DateTime<Utc>>,
    /// Players with a personal best on any style or track.
    pub players: i64,
    /// Every valid run finished on the map, on any style or track.
    pub runs: i64,
    /// The number of tiers, once the community has decided one. Tiers are None until then.
    pub tier_count: Option<i16>,
    /// Tracks somebody has finished, main (0) first.
    pub tracks: Vec<MapTrack>,
    /// The map stripped for the replay viewer. None until it has been made.
    pub viewer_file: Option<ViewerFile>,
    /// Players on its pre-2.0 board (normal, main track), banned players left out. When there are any, that
    /// board has the "2.0 + pre-2.0" and "Pre-2.0" views.
    pub legacy_players: i64,
    /// Every pre-2.0 run on that board, not just personal bests, banned players' left out.
    pub legacy_runs: i64,
    /// Players on its "2.0 + pre-2.0" view, each counted once. 0 when there are no pre-2.0 runs.
    pub all_players: i64,
    /// The pre-2.0 board's record history, oldest first, for the "Pre-2.0" view: never 2.0 world records.
    /// Entries carry the old site's run IDs. Empty when there are no dated pre-2.0 runs.
    pub legacy_record_history: Vec<WrHistoryEntry>,
    /// When its latest dated pre-2.0 run finished, banned players' left out; the pre-2.0 record held through it.
    pub legacy_last_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapTrack {
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    pub tier: Option<i16>,
    /// Styles somebody has finished this track in, sorted by style key.
    pub styles: Vec<MapStyle>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapStyle {
    pub style: String,
    /// Players with a personal best here.
    pub players: i64,
    /// Valid runs finished here, personal bests or not.
    pub runs: i64,
    pub world_record: WorldRecord,
    /// The top of the leaderboard, so a map page can switch styles and tracks without asking again.
    pub leaderboard: Vec<LeaderboardEntry>,
    /// Pass to `GET /v1/maps/{map}/leaderboard` as `cursor` for the rest. None if this is all of it.
    pub next_cursor: Option<String>,
    /// Every record set on this leaderboard, oldest first.
    pub wr_history: Vec<WrHistoryEntry>,
}

/// The map's totals and its world records per track and style.
#[utoipa::path(
    get,
    path = "/v1/maps/{map}",
    tag = "maps",
    params(("map" = String, Path, description = "Map name")),
    responses(
        (status = OK, body = MapDetail),
        (status = NOT_FOUND, description = "SourceJump has no such map, then or now", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name", body = ErrorBody),
    ),
)]
pub async fn map_detail(
    State(state): State<AppState>,
    Path(map): Path<String>,
) -> Result<Json<MapDetail>, ApiError> {
    let map = MapName::try_from(map).map_err(ApiError::Invalid)?;
    let found = sqlx::query!(
        r#"
        SELECT m.id, m.name, m.description, m.created_at, m.last_run_at, m.players,
               (SELECT count(*) FROM runs WHERE map_id = m.id AND invalidated_at IS NULL) AS "runs!"
        FROM maps m WHERE m.name = $1
        "#,
        map.as_str()
    )
    .fetch_optional(&state.db)
    .await?;
    let legacy = legacy::board_totals(&state.db, map.as_str()).await?;
    let legacy_record_history = legacy::record_history(&state.db, map.as_str()).await?;
    let tier_count = tiers::tier_count(&state.db).await?;
    let Some(found) = found else {
        let legacy = legacy.ok_or(ApiError::NotFound("SourceJump has no such map"))?;
        return Ok(Json(known_only_before_2_0(
            map,
            tier_count,
            &legacy,
            legacy_record_history,
        )));
    };

    let tracks = tracks(&state.db, found.id, tier_count).await?;
    let release = Release::of_map(&state.db, found.id).await?;

    Ok(Json(MapDetail {
        name: found.name,
        images: image::images_of(&state.db, &state.storage, found.id).await?,
        description: found.description,
        released: release.date,
        mapper: release.mapper,
        created_at: Some(found.created_at),
        last_run_at: found.last_run_at,
        players: i64::from(found.players),
        runs: found.runs,
        tier_count,
        tracks,
        viewer_file: viewer_file::of_map(&state.db, &state.storage, found.id).await?,
        legacy_players: legacy.as_ref().map_or(0, |l| l.players),
        legacy_runs: legacy.as_ref().map_or(0, |l| l.runs),
        all_players: legacy.as_ref().map_or(0, |l| l.all_players),
        legacy_record_history,
        legacy_last_run_at: legacy.as_ref().and_then(|l| l.last_run_at),
    }))
}

/// The tracks somebody has finished, each style with its world record, first page and WR history.
async fn tracks(
    db: &PgPool,
    map_id: i64,
    tier_count: Option<i16>,
) -> Result<Vec<MapTrack>, ApiError> {
    // One row per track and style: the record holder (earliest of any tie) and the number of players.
    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT ON (pb.track, pb.style)
               pb.track, pb.style, pb.time, pb.run_id, r.finished_at,
               count(*) OVER (PARTITION BY pb.track, pb.style) AS "players!",
               p.steamid64::text AS "steamid64!", p.name, p.avatar_url, p.country_code,
               (SELECT tier FROM current_map_tiers WHERE map_id = pb.map_id AND track = pb.track) AS tier
        FROM personal_bests pb
        JOIN runs r ON r.id = pb.run_id
        JOIN players p ON p.steamid64 = pb.player_steamid64
        WHERE pb.map_id = $1
        ORDER BY pb.track, pb.style, pb.time, r.finished_at
        "#,
        map_id
    )
    .fetch_all(db)
    .await?;

    let mut boards = Boards::load(db, map_id).await?;

    let mut tracks: Vec<MapTrack> = Vec::new();
    for row in rows {
        if tracks.last().is_none_or(|last| last.track != row.track) {
            tracks.push(MapTrack {
                track: row.track,
                tier: row.tier.filter(|_| tier_count.is_some()),
                styles: Vec::new(),
            });
        }
        tracks.last_mut().expect("pushed above").styles.push({
            let board = (row.style.clone(), row.track);
            let (leaderboard, next_cursor) = leaderboard::split_page(
                boards.pages.remove(&board).unwrap_or_default(),
                usize::try_from(TOP).expect("a small constant"),
            );
            MapStyle {
                runs: boards.runs.remove(&board).unwrap_or(0),
                style: row.style,
                players: row.players,
                leaderboard,
                next_cursor,
                wr_history: boards.histories.remove(&board).unwrap_or_default(),
                world_record: WorldRecord {
                    player: PlayerRef {
                        steamid64: row.steamid64,
                        name: row.name,
                        avatar_url: row.avatar_url,
                        country_code: row.country_code,
                    },
                    time: row.time,
                    run_id: row.run_id,
                    finished_at: row.finished_at,
                },
            }
        });
    }
    Ok(tracks)
}

/// Groups a map's rows by board: style and track.
/// What the map page shows per style and track, keyed by both: each board's valid runs, its first page (one
/// entry past `TOP`, to tell whether there's a next page) and its WR history.
struct Boards {
    runs: HashMap<(String, i16), i64>,
    pages: HashMap<(String, i16), Vec<LeaderboardEntry>>,
    histories: HashMap<(String, i16), Vec<WrHistoryEntry>>,
}

impl Boards {
    async fn load(db: &PgPool, map_id: i64) -> Result<Self, ApiError> {
        let entries = leaderboard::entries(db, map_id, None, None, TOP + 1).await?;
        let records = wr_history::records(db, map_id, None).await?;
        Ok(Self {
            runs: runs_per_board(db, map_id).await?,
            pages: by_board(
                entries
                    .into_iter()
                    .map(|row| ((row.style, row.track), row.entry)),
            ),
            histories: by_board(records.into_iter().map(|r| ((r.style, r.track), r.entry))),
        })
    }
}

fn by_board<T>(rows: impl Iterator<Item = ((String, i16), T)>) -> HashMap<(String, i16), Vec<T>> {
    let mut boards: HashMap<(String, i16), Vec<T>> = HashMap::new();
    for (board, row) in rows {
        boards.entry(board).or_default().push(row);
    }
    boards
}

/// Valid runs per style and track, so a map page's numbers follow the board it shows.
async fn runs_per_board(
    db: &PgPool,
    map_id: i64,
) -> Result<HashMap<(String, i16), i64>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT style, track, count(*) AS "runs!" FROM runs
           WHERE map_id = $1 AND invalidated_at IS NULL GROUP BY style, track"#,
        map_id
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| ((row.style, row.track), row.runs))
        .collect())
}

/// A map the old site knew and 2.0 hasn't seen run: no 2.0 boards, pictures or files yet.
fn known_only_before_2_0(
    map: MapName,
    tier_count: Option<i16>,
    legacy: &legacy::BoardTotals,
    legacy_record_history: Vec<WrHistoryEntry>,
) -> MapDetail {
    MapDetail {
        name: map.into(),
        images: Vec::new(),
        description: None,
        released: None,
        mapper: None,
        created_at: None,
        last_run_at: None,
        players: 0,
        runs: 0,
        tier_count,
        tracks: Vec::new(),
        viewer_file: None,
        legacy_players: legacy.players,
        legacy_runs: legacy.runs,
        all_players: legacy.all_players,
        legacy_record_history,
        legacy_last_run_at: legacy.last_run_at,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::MapDetail;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn summarizes_tracks_and_styles(db: PgPool) {
        let key = setup(&db).await;
        let mut tie = run("b", 30.0);
        tie["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        tie["finished_at"] = json!(1_792_500_000);
        let mut bonus = run("c", 12.0);
        bonus["track"] = json!(1);
        for body in [&run("a", 30.0), &tie, &run("slower", 31.0), &bonus] {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), body)
                    .await
                    .status,
                201
            );
        }

        let map: MapDetail = test_client::get(&db, "/v1/maps/bhop_badges").await.json();

        assert_eq!((map.players, map.runs), (2, 4));
        assert!(map.last_run_at.is_some());
        let tracks: Vec<_> = map.tracks.iter().map(|t| t.track).collect();
        assert_eq!(tracks, [0, 1]);
        let main = &map.tracks[0].styles[0];
        assert_eq!(main.players, 2);
        assert_eq!((main.runs, map.tracks[1].styles[0].runs), (3, 1));
        // A tie goes to whoever set the time first.
        assert_eq!(main.world_record.player.name, "gabe");
        assert_eq!(map.tracks[1].styles[0].world_record.time, 12.0);
        let ranks: Vec<_> = main.leaderboard.iter().map(|e| e.rank).collect();
        assert_eq!(ranks, [1, 1]);
        assert_eq!(main.next_cursor, None);
        // Only the first 30 is a record: equalling it or running slower later is not.
        assert_eq!(main.wr_history.len(), 1);
    }

    #[sqlx::test]
    async fn unknown_maps_and_bad_names(db: PgPool) {
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_none").await.status,
            404
        );
        assert_eq!(test_client::get(&db, "/v1/maps/bhop%20x").await.status, 422);
    }
}
