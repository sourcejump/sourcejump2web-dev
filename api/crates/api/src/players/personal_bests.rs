//! A player's personal bests with their placements, `GET /v1/players/{player}/personal-bests`, a page at a
//! time: in one style by map, or in every style with the most recent first. The profile carries the first page of each style. The legacy board's style also has the
//! "2.0 + pre-2.0" and "Pre-2.0" views (`legacy.rs`).

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};

use super::SteamId64;
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    legacy::{self, View},
    maps::tiers,
};

pub const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct PersonalBestsQuery {
    /// Style key. Leave out for every style, most recently finished first.
    style: Option<String>,
    /// 1 to 100. Default 50.
    limit: Option<i64>,
    /// Continue after this point: a `next_cursor` from an earlier page or the profile. Leave out for the start.
    cursor: Option<String>,
    /// Main tracks or bonuses only. Leave out for both.
    #[param(inline)]
    tracks: Option<Tracks>,
    /// Which runs to show. Views other than `current` exist only for the normal style's main tracks, and
    /// show those alone.
    #[param(inline)]
    view: Option<View>,
    /// True for only the personal bests that rank first: their world records, ties included. 2.0 runs only.
    records: Option<bool>,
}

/// Which of a map's tracks a list of personal bests covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Tracks {
    /// Track 0 of each map.
    Main,
    /// Tracks 1 and up.
    Bonuses,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PersonalBestPage {
    /// None when the page covers every style.
    pub style: Option<String>,
    /// In one style, sorted by map and track; in every style, most recently finished first.
    pub personal_bests: Vec<PersonalBest>,
    /// Pass as `cursor` for the personal bests after these. None at the end.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PersonalBest {
    pub style: String,
    pub map: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    /// The board's tier. None while tiers aren't in force or staff haven't set this board's, and for a legacy
    /// run.
    pub tier: Option<i16>,
    /// Seconds.
    pub time: f64,
    /// The board's 2.0 record time, as on its map leaderboard, so a client can show the gap to it. None for a
    /// legacy run.
    pub world_record_time: Option<f64>,
    /// Placement on the map's 2.0 leaderboard for this style and track. Equal times share a placement. None
    /// for a legacy run, which has no 2.0 placement.
    pub rank: Option<i64>,
    /// A legacy run from the old site, on the main track. Its `run_id` is then the old site's, and it has no
    /// run page.
    pub legacy: bool,
    pub run_id: i64,
    /// None only for a few legacy runs whose date the old site stored unreadably.
    pub finished_at: Option<DateTime<Utc>>,
}

/// Where a page starts: after this map and track, or, most recent first, after this finish time and run.
pub(super) enum Position {
    ByMap(String, i16),
    Recent(DateTime<Utc>, i64),
}

/// Which personal bests to list, and in what order.
#[derive(Clone, Copy, Default)]
pub(super) struct Selection<'a> {
    /// One style, or every style.
    pub style: Option<&'a str>,
    /// Main tracks or bonuses, or both.
    pub tracks: Option<Tracks>,
    /// World records alone.
    pub records_only: bool,
    /// Most recently finished first, rather than by style, map and track.
    pub recent_first: bool,
}

/// The player's personal bests with placements, as `selection` asks; `after` continues after a position, and
/// `limit` caps the count (None for all of them). `tiers_in_force` is whether a tier count is published.
pub(super) async fn personal_bests(
    db: &PgPool,
    steamid64: SteamId64,
    selection: Selection<'_>,
    after: Option<&Position>,
    limit: Option<i64>,
    tiers_in_force: bool,
) -> Result<Vec<PersonalBest>, sqlx::Error> {
    let (after_map, after_time) = match after {
        Some(Position::ByMap(map, track)) => (Some((map.as_str(), *track)), None),
        Some(Position::Recent(finished_at, run_id)) => (None, Some((*finished_at, *run_id))),
        None => (None, None),
    };
    // The player's own rows are picked and paged first; each one's placement is then one more than the
    // personal bests faster than it on its board, an index range on `personal_bests_board`. Ranking whole
    // boards and keeping the player's rows read every board they're on. Record times and tiers too are
    // looked up for the page's rows alone.
    let rows = sqlx::query!(
        r#"
        SELECT own.style AS "style!", own.map AS "map!", own.track AS "track!", own.time AS "time!",
               1 + (SELECT count(*) FROM personal_bests faster
                    WHERE faster.map_id = own.map_id AND faster.style = own.style
                      AND faster.track = own.track AND faster.time < own.time) AS "rank!",
               (SELECT min(best.time) FROM personal_bests best
                WHERE best.map_id = own.map_id AND best.style = own.style
                  AND best.track = own.track) AS "world_record_time!",
               own.run_id AS "run_id!", own.finished_at AS "finished_at!", tier.tier AS "tier?"
        FROM (
            SELECT pb.style, pb.map_id, m.name AS map, pb.track, pb.time, pb.run_id, pb.finished_at
            FROM personal_bests pb
            JOIN maps m ON m.id = pb.map_id
            WHERE pb.player_steamid64 = $1
              AND ($2::text IS NULL OR pb.style = $2)
              AND ($3::text IS NULL OR (m.name, pb.track) > ($3, $4::smallint))
              AND ($6::bool IS NULL OR (pb.track > 0) = $6)
              AND (NOT $7 OR EXISTS (
                  SELECT 1 FROM world_record_holders h
                  WHERE h.player_steamid64 = $1 AND h.map_id = pb.map_id AND h.style = pb.style
                    AND h.track = pb.track))
              AND ($9::timestamptz IS NULL OR (pb.finished_at, pb.run_id) < ($9, $10::int8))
            ORDER BY CASE WHEN $8 THEN pb.finished_at END DESC, CASE WHEN $8 THEN pb.run_id END DESC,
                     pb.style, m.name, pb.track
            LIMIT $5
        ) own
        LEFT JOIN current_map_tiers tier ON $11 AND tier.map_id = own.map_id AND tier.track = own.track
        ORDER BY CASE WHEN $8 THEN own.finished_at END DESC, CASE WHEN $8 THEN own.run_id END DESC,
                 own.style, own.map, own.track
        "#,
        steamid64.get(),
        selection.style,
        after_map.map(|(map, _)| map),
        after_map.map(|(_, track)| track),
        limit,
        selection.tracks.map(|tracks| tracks == Tracks::Bonuses),
        selection.records_only,
        selection.recent_first,
        after_time.map(|(finished_at, _)| finished_at),
        after_time.map(|(_, run_id)| run_id),
        tiers_in_force
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| PersonalBest {
            style: row.style,
            map: row.map,
            track: row.track,
            tier: row.tier,
            time: row.time,
            world_record_time: Some(row.world_record_time),
            rank: Some(row.rank),
            legacy: false,
            run_id: row.run_id,
            finished_at: Some(row.finished_at),
        })
        .collect())
}

/// The player's main-track personal bests in the legacy board's style for the "2.0 + pre-2.0" or "Pre-2.0"
/// view, sorted by map. With both, each map shows the faster of their 2.0 and legacy runs (the 2.0 one on
/// equal times). A player banned from records shows no legacy runs, as on the
/// old site. Only the 2.0 runs can have a tier and a record time.
async fn view_personal_bests(
    db: &PgPool,
    steamid64: SteamId64,
    view: View,
    after: Option<(&str, i16)>,
    limit: i64,
    tiers_in_force: bool,
) -> Result<Vec<PersonalBest>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT shown.map AS "map!", shown.track AS "track!", shown.time AS "time!",
               CASE WHEN NOT shown.legacy THEN 1 + (
                   SELECT count(*) FROM personal_bests faster
                   WHERE faster.map_id = shown.map_id AND faster.style = $2 AND faster.track = shown.track
                     AND faster.time < shown.time) END AS rank,
               CASE WHEN NOT shown.legacy THEN (
                   SELECT min(best.time) FROM personal_bests best
                   WHERE best.map_id = shown.map_id AND best.style = $2 AND best.track = shown.track)
               END AS world_record_time,
               shown.legacy AS "legacy!", shown.id AS "id!", shown.finished_at, tier.tier AS "tier?"
        FROM (
            SELECT DISTINCT ON (both_kinds.map, both_kinds.track) both_kinds.*
            FROM (
                SELECT m.name AS map, pb.map_id, pb.track, pb.time, false AS legacy, pb.run_id AS id,
                       pb.finished_at
                FROM personal_bests pb
                JOIN maps m ON m.id = pb.map_id
                WHERE $3 AND pb.player_steamid64 = $1 AND pb.style = $2 AND pb.track = $4
                UNION ALL
                SELECT lm.name, NULL::bigint, $4::smallint, l.time, true, l.id::bigint, l.finished_at
                FROM legacy_personal_bests l
                JOIN legacy_maps lm ON lm.id = l.map_id
                WHERE l.player_steamid64 = $1 AND NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = $1)
            ) both_kinds
            WHERE $5::text IS NULL OR (both_kinds.map, both_kinds.track) > ($5, $6::smallint)
            ORDER BY both_kinds.map, both_kinds.track, both_kinds.time, both_kinds.legacy
            LIMIT $7
        ) shown
        -- A legacy row's map_id is NULL, so it finds no tier.
        LEFT JOIN current_map_tiers tier ON $8 AND tier.map_id = shown.map_id AND tier.track = shown.track
        ORDER BY shown.map, shown.track
        "#,
        steamid64.get(),
        legacy::STYLE,
        view == View::All,
        legacy::TRACK,
        after.map(|(map, _)| map),
        after.map(|(_, track)| track),
        limit,
        tiers_in_force
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| PersonalBest {
            style: legacy::STYLE.to_owned(),
            map: row.map,
            track: row.track,
            tier: row.tier,
            time: row.time,
            world_record_time: row.world_record_time,
            rank: row.rank,
            legacy: row.legacy,
            run_id: row.id,
            finished_at: row.finished_at,
        })
        .collect())
}

/// Keeps the first `limit` personal bests and says where the next page starts, if there is one. Callers
/// fetch one more than they show to find out. `recent_first` says which order the page is in.
pub(super) fn split_page(
    mut personal_bests: Vec<PersonalBest>,
    limit: usize,
    recent_first: bool,
) -> (Vec<PersonalBest>, Option<String>) {
    if personal_bests.len() <= limit {
        return (personal_bests, None);
    }
    personal_bests.truncate(limit);
    let cursor = personal_bests.last().map(|pb| match pb.finished_at {
        Some(finished_at) if recent_first => {
            format!("at:{}:{}", finished_at.timestamp_micros(), pb.run_id)
        }
        _ => format!("{}:{}", pb.track, pb.map),
    });
    (personal_bests, cursor)
}

/// By map, cursors name the last map and track shown rather than a run, so they still work after that
/// personal best improves; most recent first, the last finish time and run. Clients should treat them as
/// opaque.
fn position(cursor: &str) -> Result<Position, ApiError> {
    let invalid = || ApiError::Invalid("that isn't a personal bests cursor".to_owned());
    if let Some(rest) = cursor.strip_prefix("at:") {
        let (micros, run_id) = rest.split_once(':').ok_or_else(invalid)?;
        let finished_at = DateTime::from_timestamp_micros(micros.parse().map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        return Ok(Position::Recent(
            finished_at,
            run_id.parse().map_err(|_| invalid())?,
        ));
    }
    let (track, map) = cursor.split_once(':').ok_or_else(invalid)?;
    Ok(Position::ByMap(
        map.to_owned(),
        track.parse().map_err(|_| invalid())?,
    ))
}

/// The player's personal bests in one style or all of them, a page at a time. Takes any `SteamID` form, like the profile.
#[utoipa::path(
    get,
    path = "/v1/players/{player}/personal-bests",
    tag = "players",
    params(
        ("player" = String, Path, description = "SteamID64, SteamID2 (STEAM_0:1:2) or SteamID3 ([U:1:4])"),
        PersonalBestsQuery,
    ),
    responses(
        (status = OK, body = PersonalBestPage),
        (status = NOT_FOUND, description = "SourceJump has no such player", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID, or not a valid limit or cursor", body = ErrorBody),
    ),
)]
pub async fn player_personal_bests(
    State(state): State<AppState>,
    Path(player): Path<String>,
    Query(query): Query<PersonalBestsQuery>,
) -> Result<Json<PersonalBestPage>, ApiError> {
    let steamid64 = SteamId64::parse_any(&player)
        .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID")))?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let view = query.view.unwrap_or_default();
    view.check_board(query.style.as_deref().unwrap_or_default(), legacy::TRACK)
        .map_err(ApiError::Invalid)?;
    if view != View::Current && query.tracks == Some(Tracks::Bonuses) {
        return Err(ApiError::Invalid(
            "pre-2.0 runs are only on main tracks".to_owned(),
        ));
    }
    let records_only = query.records.unwrap_or(false);
    if records_only && view != View::Current {
        return Err(ApiError::Invalid(
            "pre-2.0 runs have no 2.0 placement, so no world records".to_owned(),
        ));
    }
    let after = query.cursor.as_deref().map(position).transpose()?;
    let recent_first = query.style.is_none();

    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM players WHERE steamid64 = $1)
               OR EXISTS (SELECT 1 FROM legacy_players WHERE steamid64 = $1) AS "exists!""#,
        steamid64.get()
    )
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(ApiError::NotFound("SourceJump has no such player"));
    }

    let tiers_in_force = tiers::tier_count(&state.db).await?.is_some();
    let rows = if view == View::Current {
        let selection = Selection {
            style: query.style.as_deref(),
            tracks: query.tracks,
            records_only,
            recent_first,
        };
        personal_bests(
            &state.db,
            steamid64,
            selection,
            after.as_ref(),
            Some(limit + 1),
            tiers_in_force,
        )
        .await?
    } else {
        let after = match &after {
            Some(Position::ByMap(map, track)) => Some((map.as_str(), *track)),
            Some(Position::Recent(..)) => {
                return Err(ApiError::Invalid(
                    "that isn't a personal bests cursor".to_owned(),
                ));
            }
            None => None,
        };
        view_personal_bests(&state.db, steamid64, view, after, limit + 1, tiers_in_force).await?
    };
    let (personal_bests, next_cursor) = split_page(
        rows,
        usize::try_from(limit).expect("checked to be positive"),
        recent_first,
    );

    Ok(Json(PersonalBestPage {
        style: query.style,
        personal_bests,
        next_cursor,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::PersonalBestPage;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn pages_through_one_style(db: PgPool) {
        let key = setup(&db).await;
        for (index, map) in ["bhop_a", "bhop_b", "bhop_c"].into_iter().enumerate() {
            let mut body = run(&format!("r{index}"), 30.0);
            body["map"] = json!(map);
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }
        let mut bonus = run("bonus", 10.0);
        bonus["map"] = json!("bhop_a");
        bonus["track"] = json!(1);
        test_client::post(&db, "/v1/runs", Some(&key), &bonus).await;

        let path = "/v1/players/76561197960287930/personal-bests?style=normal&limit=2";
        let first: PersonalBestPage = test_client::get(&db, path).await.json();
        let shown: Vec<_> = first
            .personal_bests
            .iter()
            .map(|pb| (pb.map.as_str(), pb.track))
            .collect();
        assert_eq!(shown, [("bhop_a", 0), ("bhop_a", 1)]);

        let cursor = first.next_cursor.expect("two more");
        let second: PersonalBestPage = test_client::get(&db, &format!("{path}&cursor={cursor}"))
            .await
            .json();
        let shown: Vec<_> = second
            .personal_bests
            .iter()
            .map(|pb| (pb.map.as_str(), pb.rank))
            .collect();
        assert_eq!(shown, [("bhop_b", Some(1)), ("bhop_c", Some(1))]);
        assert_eq!(second.next_cursor, None);

        let tracks = |tracks: &'static str| {
            let db = db.clone();
            async move {
                let path = format!(
                    "/v1/players/76561197960287930/personal-bests?style=normal&tracks={tracks}"
                );
                let page: PersonalBestPage = test_client::get(&db, &path).await.json();
                page.personal_bests
                    .into_iter()
                    .map(|pb| (pb.map, pb.track))
                    .collect::<Vec<_>>()
            }
        };
        assert_eq!(tracks("bonuses").await, [("bhop_a".to_owned(), 1)]);
        assert_eq!(tracks("main").await.len(), 3);
    }

    #[sqlx::test]
    async fn lists_every_style_most_recent_first(db: PgPool) {
        let key = setup(&db).await;
        for (index, map) in ["bhop_a", "bhop_b", "bhop_c"].into_iter().enumerate() {
            let mut body = run(&format!("r{index}"), 30.0);
            body["map"] = json!(map);
            body["finished_at"] = json!(1_792_400_000 + i64::try_from(index).unwrap() * 60);
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }

        let path = "/v1/players/76561197960287930/personal-bests?limit=2";
        let first: PersonalBestPage = test_client::get(&db, path).await.json();
        let maps = |page: &PersonalBestPage| {
            page.personal_bests
                .iter()
                .map(|pb| (pb.map.clone(), pb.style.clone()))
                .collect::<Vec<_>>()
        };
        assert_eq!(first.style, None);
        assert_eq!(
            maps(&first),
            [
                ("bhop_c".into(), "normal".into()),
                ("bhop_b".into(), "normal".into())
            ]
        );
        let cursor = first.next_cursor.clone().expect("one more");
        let second: PersonalBestPage = test_client::get(&db, &format!("{path}&cursor={cursor}"))
            .await
            .json();
        assert_eq!(maps(&second), [("bhop_a".into(), "normal".into())]);
        assert_eq!(second.next_cursor, None);
    }

    #[sqlx::test]
    async fn lists_world_records_alone(db: PgPool) {
        let key = setup(&db).await;
        let mut faster = run("f", 20.0);
        faster["player"] = json!({ "steamid64": "76561197960287931", "name": "ricochet" });
        let mut arcane = run("b", 30.0);
        arcane["map"] = json!("bhop_arcane");
        for body in [&run("a", 30.0), &faster, &arcane] {
            test_client::post(&db, "/v1/runs", Some(&key), body).await;
        }

        // gabe is second on bhop_badges and first on bhop_arcane.
        let path = "/v1/players/76561197960287930/personal-bests?style=normal&records=true";
        let page: PersonalBestPage = test_client::get(&db, path).await.json();
        let maps: Vec<_> = page
            .personal_bests
            .iter()
            .map(|pb| pb.map.as_str())
            .collect();
        assert_eq!(maps, ["bhop_arcane"]);
        let legacy = test_client::get(&db, &format!("{path}&view=legacy")).await;
        assert_eq!(legacy.status, 422);
    }

    #[sqlx::test]
    async fn unknown_players_and_bad_queries(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let get = |path: &'static str| {
            let db = db.clone();
            async move { test_client::get(&db, path).await.status }
        };

        assert_eq!(
            get("/v1/players/76561197960287931/personal-bests?style=normal").await,
            404
        );
        assert_eq!(
            get("/v1/players/76561197960287930/personal-bests?style=normal&cursor=x").await,
            422
        );
        assert_eq!(
            get("/v1/players/76561197960287930/personal-bests?style=normal&limit=0").await,
            422
        );
        assert_eq!(
            get("/v1/players/76561197960287930/personal-bests?style=sw").await,
            200
        );
    }
}
