//! The map list, `GET /v1/maps`: every map with at least one run, with its world record in one style.
//!
//! Whether a map is ranked is still a community decision (`docs/domain.md`), so the list doesn't say.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{WorldRecord, check_page, image::MapImage, tiers};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    name_search,
    players::{PlayerRef, SteamId64},
    storage::Storage,
};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct MapsQuery {
    /// Part of a map name or a main-track world record holder's name in the chosen style. Case doesn't
    /// matter; spaces in map names stand for underscores. Exact map names come first, then word starts,
    /// other map matches and record holders, each in the chosen sort; near misses come last.
    q: Option<String>,
    /// Default `name`.
    #[param(inline)]
    sort: Option<MapSort>,
    /// The style whose main-track world record each map shows. Default: the first style in the current
    /// ruleset.
    style: Option<String>,
    /// A player, by any form of `SteamID`, whose completions `completed` filters by.
    player: Option<String>,
    /// With `player`: true lists only maps whose main track they finished in the list's style, false only the
    /// rest.
    completed: Option<bool>,
    /// Only maps whose main track has this tier.
    tier: Option<i16>,
    /// 1 to 100. Default 50.
    limit: Option<i64>,
    /// Maps to skip, for paging. Default 0.
    offset: Option<i64>,
}

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MapSort {
    /// A to Z.
    Name,
    /// Z to A.
    NameDesc,
    /// Most recently run first.
    Recent,
    /// Newest on the list first: by when SourceJump received the map's first run.
    Newest,
    /// Most players first.
    Popular,
    /// Fewest players first.
    LeastPopular,
    /// Highest main-track tier first; maps without a tier last.
    Hardest,
    /// Lowest main-track tier first; maps without a tier last.
    Easiest,
    /// Slowest main-track world record in the list's style first; maps without one last.
    LongestRecord,
    /// Fastest main-track world record in the list's style first; maps without one last.
    ShortestRecord,
    /// Main-track world record in the list's style set most recently first; maps without one last.
    NewestRecord,
    /// Main-track world record in the list's style that has stood longest first; maps without one last.
    OldestRecord,
}

impl MapSort {
    /// The name the list query sorts by.
    fn key(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::NameDesc => "name_desc",
            Self::Recent => "recent",
            Self::Newest => "newest",
            Self::Popular => "popular",
            Self::LeastPopular => "least_popular",
            Self::Hardest => "hardest",
            Self::Easiest => "easiest",
            Self::LongestRecord => "longest_record",
            Self::ShortestRecord => "shortest_record",
            Self::NewestRecord => "newest_record",
            Self::OldestRecord => "oldest_record",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapList {
    pub maps: Vec<MapSummary>,
    /// How many maps match, across all pages.
    pub total: i64,
    /// The style the world records are in. None if no ruleset is published.
    pub style: Option<String>,
    /// The number of tiers, once the community has decided one. Tiers are None until then.
    pub tier_count: Option<i16>,
    /// The player the list was filtered by, if they have played. None without `player`, or for a Steam
    /// account SourceJump hasn't seen (who has completed nothing).
    pub player: Option<PlayerRef>,
    /// With `player`: how many maps on the whole list (any search aside) they finished the main track of in
    /// the list's style, out of `stats.maps`.
    pub completed: Option<i64>,
    pub stats: MapStats,
}

/// Global totals and tier-scoped newest and weekly lists.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapStats {
    /// Maps with at least one run.
    pub maps: i64,
    /// Of those, the maps whose main track has each tier, tier 1 first. Empty until a tier count is
    /// published.
    pub by_tier: Vec<i64>,
    /// The tier the newest and weekly lists describe; None describes all tiers. Totals remain global.
    pub tier: Option<i16>,
    /// The maps that joined the list last, newest first.
    pub newest: Vec<NewestMap>,
    /// The maps the most players finished a run on in the last 7 days, most first.
    pub played_this_week: Vec<PlayedMap>,
}

/// A map that joined the list recently.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct NewestMap {
    pub name: String,
    /// The main track's tier.
    pub tier: Option<i16>,
    /// When SourceJump received its first run.
    pub listed_at: DateTime<Utc>,
}

/// How many newest maps the list's stats carry.
const NEWEST: i64 = 5;

/// A map many players ran lately.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayedMap {
    pub name: String,
    /// The main track's tier.
    pub tier: Option<i16>,
    /// Players who finished a run there, any track or style, in the last 7 days.
    pub players: i64,
}

/// How many of the week's most played maps the list's stats carry.
const PLAYED_THIS_WEEK: i64 = 5;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MapSummary {
    pub name: String,
    pub image: Option<MapImage>,
    /// The main track's tier.
    pub tier: Option<i16>,
    /// Bonus tracks somebody has finished.
    pub bonuses: i64,
    /// Players with a personal best on any style or track.
    pub players: i64,
    /// When the map's latest run finished.
    pub last_run_at: DateTime<Utc>,
    /// The main track's record in the list's style. None if nobody has finished it in that style.
    pub world_record: Option<WorldRecord>,
}

/// Maps with at least one run, matching a search, sorted and paged.
#[utoipa::path(
    get,
    path = "/v1/maps",
    tag = "maps",
    params(MapsQuery),
    responses(
        (status = OK, body = MapList),
        (status = UNPROCESSABLE_ENTITY, description = "Limit or offset out of range, a `player` that isn't a SteamID, or `completed` without `player`", body = ErrorBody),
    ),
)]
pub async fn list_maps(
    State(state): State<AppState>,
    Query(query): Query<MapsQuery>,
) -> Result<Json<MapList>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    let offset = query.offset.unwrap_or(0);
    check_page(limit, offset, MAX_LIMIT).map_err(ApiError::Invalid)?;
    let sort = query.sort.unwrap_or(MapSort::Name).key();
    let search = query.q.as_deref().and_then(search_name);
    let pattern = search.as_deref().map(name_search::contains_pattern);
    let holder_pattern = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(name_search::contains_pattern);
    // Most map names start with "bhop_", which would make every map a near miss of every search.
    let near = search
        .as_deref()
        .map(|s| s.strip_prefix("bhop_").unwrap_or(s))
        .and_then(name_search::near_miss_term);
    let player = filter_player(&query)?;
    let style = match query.style {
        Some(style) => Some(style),
        None => default_style(&state.db).await?,
    };
    let filter = Filter {
        pattern: pattern.as_deref(),
        holder_pattern: holder_pattern.as_deref(),
        near,
        style: style.as_deref(),
        completed_by: query.completed.and(player).map(SteamId64::get),
        completed: query.completed,
        tier: query.tier,
    };

    let mut tx = name_search::begin(&state.db).await?;
    let total = count_maps(&mut tx, &filter).await?;

    let storage = &state.storage;
    let rows = listed_page(&mut tx, &filter, sort, search.as_deref(), limit, offset).await?;
    tx.commit().await?;

    let tier_count = tiers::tier_count(&state.db).await?;
    let list_stats = map_stats(&state.db, tier_count, query.tier).await?;
    let (player, completed) = match player {
        Some(player) => (
            known_player(&state.db, player).await?,
            Some(completed_maps(&state.db, player, style.as_deref()).await?),
        ),
        None => (None, None),
    };
    let maps = rows
        .into_iter()
        .map(|row| row.into_summary(storage, tier_count))
        .collect();

    Ok(Json(MapList {
        maps,
        total,
        style,
        tier_count,
        player,
        completed,
        stats: list_stats,
    }))
}

/// Maps with a run, how many hold each main-track tier once tiers are in force, the newest of them and the
/// week's most played.
async fn map_stats(
    db: &sqlx::PgPool,
    tier_count: Option<i16>,
    tier: Option<i16>,
) -> Result<MapStats, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT tier.tier AS "tier?", count(*) AS "maps!" FROM maps m
           LEFT JOIN current_map_tiers tier ON tier.map_id = m.id AND tier.track = 0
           WHERE m.last_run_at IS NOT NULL
           GROUP BY tier.tier"#
    )
    .fetch_all(db)
    .await?;
    let mut by_tier = vec![0; usize::try_from(tier_count.unwrap_or(0)).unwrap_or(0)];
    for row in &rows {
        let slot = row
            .tier
            .and_then(|tier| usize::try_from(tier - 1).ok())
            .and_then(|index| by_tier.get_mut(index));
        if let Some(slot) = slot {
            *slot += row.maps;
        }
    }
    let newest = sqlx::query!(
        r#"SELECT m.name, m.listed_at AS "listed_at!",
                  (SELECT tier FROM current_map_tiers WHERE map_id = m.id AND track = 0) AS tier
           FROM maps m WHERE m.last_run_at IS NOT NULL AND m.listed_at IS NOT NULL
             AND ($2::smallint IS NULL OR $2 =
                 (SELECT tier FROM current_map_tiers WHERE map_id = m.id AND track = 0))
           ORDER BY m.listed_at DESC, m.name LIMIT $1"#,
        NEWEST,
        tier
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| NewestMap {
        name: row.name,
        tier: row.tier.filter(|_| tier_count.is_some()),
        listed_at: row.listed_at,
    })
    .collect();
    // Players rather than runs, so one player grinding a map doesn't top the list. Counted by the game
    // server's finish time, which the `runs_recent` index covers.
    let played_this_week = sqlx::query!(
        r#"SELECT m.name, week.players AS "players!",
                  (SELECT tier FROM current_map_tiers WHERE map_id = m.id AND track = 0) AS tier
           FROM (SELECT map_id, count(DISTINCT player_steamid64) AS players FROM runs
                 WHERE invalidated_at IS NULL AND finished_at > now() - interval '7 days'
                 GROUP BY map_id) week
           JOIN maps m ON m.id = week.map_id
           WHERE $2::smallint IS NULL OR $2 =
                 (SELECT tier FROM current_map_tiers WHERE map_id = m.id AND track = 0)
           ORDER BY week.players DESC, m.name LIMIT $1"#,
        PLAYED_THIS_WEEK,
        tier
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| PlayedMap {
        name: row.name,
        tier: row.tier.filter(|_| tier_count.is_some()),
        players: row.players,
    })
    .collect();
    Ok(MapStats {
        maps: rows.iter().map(|row| row.maps).sum(),
        by_tier,
        tier,
        newest,
        played_this_week,
    })
}

/// How many maps on the list the player finished the main track of in the style.
async fn completed_maps(
    db: &sqlx::PgPool,
    player: SteamId64,
    style: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM personal_bests pb JOIN maps m ON m.id = pb.map_id
           WHERE pb.player_steamid64 = $1 AND pb.style = $2 AND pb.track = 0 AND m.last_run_at IS NOT NULL"#,
        player.get(),
        style
    )
    .fetch_one(db)
    .await
}

/// The query's `player`, which `completed` needs.
fn filter_player(query: &MapsQuery) -> Result<Option<SteamId64>, ApiError> {
    let player = query
        .player
        .as_deref()
        .map(|text| {
            SteamId64::parse_any(text)
                .ok_or_else(|| ApiError::Invalid(format!("{text:?} is not a SteamID")))
        })
        .transpose()?;
    if query.completed.is_some() && player.is_none() {
        return Err(ApiError::Invalid("completed needs a player".into()));
    }
    Ok(player)
}

/// The player the list is filtered by, if SourceJump has seen them.
async fn known_player(
    db: &sqlx::PgPool,
    player: SteamId64,
) -> Result<Option<PlayerRef>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT name, avatar_url, country_code FROM players WHERE steamid64 = $1",
        player.get()
    )
    .fetch_optional(db)
    .await?;
    Ok(row.map(|row| PlayerRef {
        steamid64: player.to_string(),
        name: row.name,
        avatar_url: row.avatar_url,
        country_code: row.country_code,
    }))
}

/// One page of the list, in order, with each map's cover and its world record in the filter's style. Pages
/// first, then looks up records for only the maps on the page.
async fn listed_page(
    tx: &mut sqlx::PgConnection,
    filter: &Filter<'_>,
    sort: &str,
    search: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<ListedMap>, sqlx::Error> {
    sqlx::query_as!(
        ListedMap,
        r#"
        WITH holder_maps AS (
            SELECT h.map_id FROM world_record_holders h
            JOIN players p ON p.steamid64 = h.player_steamid64
            WHERE $11::text IS NOT NULL AND h.style = $5 AND h.track = 0
              AND p.name ILIKE $11 ESCAPE '\'
        ), listed AS (
            SELECT m.id, m.name, m.last_run_at, m.players, tier.tier,
                   row_number() OVER (ORDER BY
                       -- How well the name matches: exactly, by a word's start ("candy" in bhop_candy), or within.
                       CASE WHEN $6::text IS NULL OR m.name = $6 THEN 0
                            WHEN starts_with(m.name, $6) OR strpos(m.name, '_' || $6) > 0 THEN 1
                            WHEN m.name ILIKE $1 ESCAPE '\' THEN 2
                            WHEN m.id IN (SELECT map_id FROM holder_maps) THEN 3 ELSE 4 END,
                       CASE WHEN m.name NOT ILIKE $1 ESCAPE '\' AND $7 <% m.name
                            THEN word_similarity($7, m.name) END DESC NULLS LAST,
                       CASE WHEN $2 = 'recent' THEN m.last_run_at END DESC,
                       CASE WHEN $2 = 'newest' THEN m.listed_at END DESC NULLS LAST,
                       CASE $2 WHEN 'popular' THEN -m.players WHEN 'least_popular' THEN m.players END,
                       CASE $2 WHEN 'hardest' THEN -tier.tier WHEN 'easiest' THEN tier.tier END NULLS LAST,
                       CASE $2 WHEN 'longest_record' THEN -record.time WHEN 'shortest_record' THEN record.time END
                           NULLS LAST,
                       CASE WHEN $2 = 'newest_record' THEN record.finished_at END DESC NULLS LAST,
                       CASE WHEN $2 = 'oldest_record' THEN record.finished_at END NULLS LAST,
                       CASE WHEN $2 = 'name_desc' THEN m.name END DESC,
                       m.name
                   ) AS position
            FROM maps m
            LEFT JOIN current_map_tiers tier ON tier.map_id = m.id AND tier.track = 0
            -- Every map's record, read only for the sorts that need it: the page below reads the page's own.
            LEFT JOIN LATERAL (
                SELECT pb.time, r.finished_at
                FROM personal_bests pb JOIN runs r ON r.id = pb.run_id
                WHERE $2 IN ('longest_record', 'shortest_record', 'newest_record', 'oldest_record') AND pb.map_id = m.id AND pb.style = $5 AND pb.track = 0
                ORDER BY pb.time, r.finished_at
                LIMIT 1
            ) record ON true
            WHERE m.last_run_at IS NOT NULL AND ($1::text IS NULL OR m.name ILIKE $1 ESCAPE '\'
                OR $7 <% m.name OR m.id IN (SELECT map_id FROM holder_maps))
              AND ($8::bigint IS NULL OR $9 = EXISTS (
                  SELECT 1 FROM personal_bests WHERE player_steamid64 = $8 AND map_id = m.id AND style = $5 AND track = 0))
              AND ($10::smallint IS NULL OR tier.tier = $10)
        ), page AS (
            SELECT * FROM listed WHERE position > $4 ORDER BY position LIMIT $3
        )
        SELECT page.name, ci.id AS "image_id?", ci.key AS "image_key?", ci.focus AS "image_focus?", page.last_run_at AS "last_run_at!", page.players::int8 AS "players!",
               counts.bonuses AS "bonuses!", page.tier AS "tier?",
               wr.time AS "wr_time?", wr.run_id AS "wr_run_id?", wr.finished_at AS "wr_finished_at?",
               p.steamid64::text AS "wr_steamid64?", p.name AS "wr_name?", p.avatar_url AS "wr_avatar_url?",
               p.country_code AS "wr_country_code?"
        FROM page
        LEFT JOIN map_images ci ON ci.map_id = page.id AND ci.position = 0
        CROSS JOIN LATERAL (
            SELECT count(DISTINCT track) FILTER (WHERE track > 0) AS bonuses
            FROM personal_bests WHERE map_id = page.id
        ) counts
        LEFT JOIN LATERAL (
            SELECT pb.player_steamid64, pb.time, pb.run_id, r.finished_at
            FROM personal_bests pb JOIN runs r ON r.id = pb.run_id
            WHERE pb.map_id = page.id AND pb.style = $5 AND pb.track = 0
            ORDER BY pb.time, r.finished_at
            LIMIT 1
        ) wr ON true
        LEFT JOIN players p ON p.steamid64 = wr.player_steamid64
        ORDER BY page.position
        "#,
        filter.pattern,
        sort,
        limit,
        offset,
        filter.style,
        search,
        filter.near,
        filter.completed_by,
        filter.completed,
        filter.tier,
        filter.holder_pattern
    )
    .fetch_all(tx)
    .await
}

/// A row of the list query: a map on the page with its cover and world record, flattened.
struct ListedMap {
    name: String,
    image_id: Option<i64>,
    image_key: Option<String>,
    image_focus: Option<i16>,
    last_run_at: DateTime<Utc>,
    players: i64,
    bonuses: i64,
    tier: Option<i16>,
    wr_time: Option<f64>,
    wr_run_id: Option<i64>,
    wr_finished_at: Option<DateTime<Utc>>,
    wr_steamid64: Option<String>,
    wr_name: Option<String>,
    wr_avatar_url: Option<String>,
    wr_country_code: Option<String>,
}

impl ListedMap {
    fn into_summary(self, storage: &Storage, tier_count: Option<i16>) -> MapSummary {
        let world_record = match (self.wr_time, self.wr_run_id, self.wr_finished_at) {
            (Some(time), Some(run_id), Some(finished_at)) => Some(WorldRecord {
                player: PlayerRef {
                    steamid64: self.wr_steamid64.unwrap_or_default(),
                    name: self.wr_name.unwrap_or_default(),
                    avatar_url: self.wr_avatar_url,
                    country_code: self.wr_country_code,
                },
                time,
                run_id,
                finished_at,
            }),
            _ => None,
        };
        MapSummary {
            name: self.name,
            image: MapImage::cover(storage, self.image_id, self.image_key, self.image_focus),
            tier: self.tier.filter(|_| tier_count.is_some()),
            bonuses: self.bonuses,
            players: self.players,
            last_run_at: self.last_run_at,
            world_record,
        }
    }
}

/// Which maps the list holds, shared by the page and the count.
struct Filter<'a> {
    /// The search as an `ILIKE` pattern.
    pattern: Option<&'a str>,
    /// The original search, preserving spaces in player names.
    holder_pattern: Option<&'a str>,
    /// The search's term for near misses.
    near: Option<&'a str>,
    style: Option<&'a str>,
    completed_by: Option<i64>,
    /// With `completed_by`: keep the maps they finished (true) or the rest (false).
    completed: Option<bool>,
    /// Keep the maps whose main track has this tier.
    tier: Option<i16>,
}

/// How many maps with a run match the filter, across all pages.
async fn count_maps(tx: &mut sqlx::PgConnection, filter: &Filter<'_>) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM maps m
           WHERE last_run_at IS NOT NULL AND ($1::text IS NULL OR name ILIKE $1 ESCAPE '\' OR $2 <% name
             OR EXISTS (SELECT 1 FROM world_record_holders h JOIN players p ON p.steamid64 = h.player_steamid64
                        WHERE h.map_id = m.id AND h.style = $5 AND h.track = 0 AND p.name ILIKE $7 ESCAPE '\'))
             AND ($3::bigint IS NULL OR $4 = EXISTS (
                 SELECT 1 FROM personal_bests WHERE player_steamid64 = $3 AND map_id = m.id AND style = $5 AND track = 0))
             AND ($6::smallint IS NULL OR $6 = (SELECT tier FROM current_map_tiers WHERE map_id = m.id AND track = 0))"#,
        filter.pattern,
        filter.near,
        filter.completed_by,
        filter.completed,
        filter.style,
        filter.tier,
        filter.holder_pattern
    )
    .fetch_one(tx)
    .await
}

/// A search as map names are written: lower case, with underscores for spaces, since no map name has a space
/// and players often type one ("candy saarc"). None for an empty search.
fn search_name(q: &str) -> Option<String> {
    let words: Vec<&str> = q.split_whitespace().collect();
    (!words.is_empty()).then(|| words.join("_").to_lowercase())
}

/// The first style in the current ruleset, which the list shows records in unless asked for another.
pub(crate) async fn default_style(db: &sqlx::PgPool) -> Result<Option<String>, sqlx::Error> {
    let style = sqlx::query_scalar!(
        "SELECT document->'styles'->0->>'key' FROM rulesets ORDER BY version DESC LIMIT 1"
    )
    .fetch_optional(db)
    .await?;
    Ok(style.flatten())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::MapList;
    use crate::{
        runs::{
            invalidation,
            tests::{run, setup},
        },
        test_client,
    };

    async fn names(db: &PgPool, path: &str) -> Vec<String> {
        let list: MapList = test_client::get(db, path).await.json();
        list.maps.into_iter().map(|map| map.name).collect()
    }

    #[sqlx::test]
    async fn lists_maps_with_runs_and_their_world_records(db: PgPool) {
        let key = setup(&db).await;
        let mut second = run("b", 25.0);
        second["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        let mut other = run("c", 10.0);
        other["map"] = json!("bhop_arcane");
        other["finished_at"] = json!(1_792_500_000);
        for body in [&run("a", 30.0), &second, &other] {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), body)
                    .await
                    .status,
                201
            );
        }
        // A map added by a zone import, with no runs, isn't listed.
        sqlx::query("INSERT INTO maps (name) VALUES ('bhop_unplayed')")
            .execute(&db)
            .await
            .unwrap();

        let list: MapList = test_client::get(&db, "/v1/maps").await.json();

        assert_eq!(list.total, 2);
        assert_eq!(list.style.as_deref(), Some("normal"));
        assert_eq!(list.tier_count, None);
        let badges = &list.maps[1];
        assert_eq!(badges.name, "bhop_badges");
        assert_eq!(badges.players, 2);
        assert_eq!(badges.tier, None);
        let wr = badges.world_record.as_ref().unwrap();
        assert_eq!((wr.player.name.as_str(), wr.time), ("second", 25.0));

        assert_eq!(
            names(&db, "/v1/maps?sort=recent").await,
            ["bhop_arcane", "bhop_badges"]
        );
        assert_eq!(
            names(&db, "/v1/maps?sort=popular").await,
            ["bhop_badges", "bhop_arcane"]
        );
        // bhop_badges joined the list first; a later run there doesn't make it new again.
        assert_eq!(
            names(&db, "/v1/maps?sort=newest").await,
            ["bhop_arcane", "bhop_badges"]
        );
        let newest: Vec<_> = list.stats.newest.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(newest, ["bhop_arcane", "bhop_badges"]);
        assert_eq!(names(&db, "/v1/maps?q=BADG").await, ["bhop_badges"]);
        assert_eq!(
            names(&db, "/v1/maps?limit=1&offset=1").await,
            ["bhop_badges"]
        );
        let sideways: MapList = test_client::get(&db, "/v1/maps?style=sw").await.json();
        assert!(sideways.maps.iter().all(|map| map.world_record.is_none()));
        assert_eq!(test_client::get(&db, "/v1/maps?limit=0").await.status, 422);
        assert_eq!(
            test_client::get(&db, "/v1/maps?sort=best").await.status,
            400
        );
    }

    #[sqlx::test]
    async fn searches_current_main_track_record_holders_in_the_selected_style(db: PgPool) {
        let key = setup(&db).await;
        sqlx::query(
            r#"INSERT INTO rulesets (version, document)
               SELECT 2, jsonb_set(document, '{styles}',
                   (document->'styles') || '[{"key":"sw","name":"Sideways","settings":{}}]'::jsonb)
               FROM rulesets WHERE version = 1"#,
        )
        .execute(&db)
        .await
        .unwrap();
        for (id, map, player, name, time, style, track) in [
            (
                "holder-main",
                "bhop_badges",
                0,
                "Speed Runner",
                30.0,
                "normal",
                0,
            ),
            (
                "holder-second",
                "bhop_arcane",
                0,
                "Speed Runner",
                15.0,
                "normal",
                0,
            ),
            ("slower", "bhop_badges", 1, "Bonus Hero", 40.0, "normal", 0),
            ("bonus", "bhop_badges", 1, "Bonus Hero", 10.0, "normal", 1),
            ("sideways", "bhop_badges", 1, "Bonus Hero", 20.0, "sw", 0),
            ("tied", "bhop_badges", 2, "Co Holder", 30.0, "normal", 0),
        ] {
            let mut body = run(id, time);
            body["map"] = json!(map);
            body["player"] = json!({
                "steamid64": (76_561_197_960_287_930_i64 + player).to_string(),
                "name": name,
            });
            body["style"] = json!(style);
            body["track"] = json!(track);
            body["ruleset_version"] = json!(2);
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), &body)
                    .await
                    .status,
                201
            );
        }
        let page: MapList = test_client::get(&db, "/v1/maps?q=SPEED%20RUNNER&limit=1&offset=1")
            .await
            .json();
        assert_eq!(page.total, 2);
        assert_eq!(page.maps.len(), 1);
        assert_eq!(page.maps[0].name, "bhop_badges");
        assert_eq!(names(&db, "/v1/maps?q=Co%20Holder").await, ["bhop_badges"]);
        assert_eq!(names(&db, "/v1/maps?q=Bonus%20Hero").await.len(), 0);
        assert_eq!(
            names(&db, "/v1/maps?q=Bonus%20Hero&style=sw").await,
            ["bhop_badges"]
        );
        assert_eq!(names(&db, "/v1/maps?q=%25").await.len(), 0);
    }

    /// `bhop_badges`' stored player count, and the count its personal bests give.
    async fn badges_players(db: &PgPool) -> (i32, i64) {
        sqlx::query_as(
            "SELECT m.players, (SELECT count(DISTINCT player_steamid64) FROM personal_bests WHERE map_id = m.id)
             FROM maps m WHERE name = 'bhop_badges'",
        )
        .fetch_one(db)
        .await
        .unwrap()
    }

    #[sqlx::test]
    async fn keeps_each_maps_player_count_as_personal_bests_change(db: PgPool) {
        let key = setup(&db).await;
        let mut bonus = run("b", 40.0);
        bonus["track"] = json!(1);
        let mut second = run("c", 25.0);
        second["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        // A player's second track on a map is still one player.
        for (body, players) in [(&run("a", 30.0), 1), (&bonus, 1), (&second, 2)] {
            let status = test_client::post(&db, "/v1/runs", Some(&key), body)
                .await
                .status;
            assert_eq!(status, 201);
            assert_eq!(badges_players(&db).await, (players, i64::from(players)));
        }

        let second_run: i64 = sqlx::query_scalar("SELECT id FROM runs WHERE server_run_id = 'c'")
            .fetch_one(&db)
            .await
            .unwrap();
        let log_id: i64 = sqlx::query_scalar(
            "INSERT INTO staff_log (action, target, reason) VALUES ('invalidate_run', 'c', 'x') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let mut conn = db.acquire().await.unwrap();
        invalidation::invalidate(&mut conn, &[second_run], log_id)
            .await
            .unwrap();
        assert_eq!(badges_players(&db).await, (1, 1));
        invalidation::restore(&mut conn, &[second_run])
            .await
            .unwrap();
        assert_eq!(badges_players(&db).await, (2, 2));

        let popular: MapList = test_client::get(&db, "/v1/maps?sort=popular").await.json();
        assert_eq!(popular.maps[0].players, 2);
    }

    #[sqlx::test]
    async fn counts_the_weeks_players_per_map(db: PgPool) {
        let key = setup(&db).await;
        let mut second = run("b", 25.0);
        second["player"] = json!({ "steamid64": "76561197960287931", "name": "second" });
        let mut arcane = run("c", 10.0);
        arcane["map"] = json!("bhop_arcane");
        let mut arcane_again = run("d", 9.0);
        arcane_again["map"] = json!("bhop_arcane");
        let mut candy = run("e", 40.0);
        candy["map"] = json!("bhop_candy");
        for body in [&run("a", 30.0), &second, &arcane, &arcane_again, &candy] {
            assert_eq!(
                test_client::post(&db, "/v1/runs", Some(&key), body)
                    .await
                    .status,
                201
            );
        }
        // bhop_candy's only run is older than a week.
        sqlx::query(
            "UPDATE runs SET finished_at = now() - CASE WHEN server_run_id = 'e' THEN interval '10 days'
                                                       ELSE interval '1 day' END",
        )
        .execute(&db)
        .await
        .unwrap();

        let list: MapList = test_client::get(&db, "/v1/maps").await.json();

        // Two runs by one player on bhop_arcane count once.
        let week: Vec<_> = list
            .stats
            .played_this_week
            .iter()
            .map(|m| (m.name.as_str(), m.players))
            .collect();
        assert_eq!(week, [("bhop_badges", 2), ("bhop_arcane", 1)]);
    }

    #[sqlx::test]
    async fn stats_rank_within_a_tier_before_taking_the_top_five(db: PgPool) {
        let key = setup(&db).await;
        let policy = crate::policies::Policy::Tiers(crate::policies::TiersPolicy { count: 2 });
        crate::policies::publish(&mut db.acquire().await.unwrap(), &policy)
            .await
            .unwrap();
        for index in 0..12 {
            let name = format!("bhop_tier_{index:02}");
            let players = if index < 5 { 2 } else { 1 };
            for player in 0..players {
                let mut body = run(&format!("tier-{index}-{player}"), 30.0);
                body["map"] = json!(name);
                body["player"] = json!({
                    "steamid64": (76_561_197_960_287_930_i64 + player).to_string(),
                    "name": format!("player-{player}"),
                });
                assert_eq!(
                    test_client::post(&db, "/v1/runs", Some(&key), &body)
                        .await
                        .status,
                    201
                );
            }
            let map = crate::maps::MapName::try_from(name.clone()).unwrap();
            crate::staff::maps::set_tier(&db, None, &map, 0, if index < 5 { 1 } else { 2 })
                .await
                .unwrap();
            sqlx::query(
                "UPDATE maps SET listed_at = now() - $1 * interval '1 minute' WHERE name = $2",
            )
            .bind(f64::from(index))
            .bind(name)
            .execute(&db)
            .await
            .unwrap();
        }
        sqlx::query("UPDATE runs SET finished_at = now() - interval '1 day'")
            .execute(&db)
            .await
            .unwrap();

        let all: MapList = test_client::get(&db, "/v1/maps").await.json();
        assert_eq!(all.stats.tier, None);
        assert!(
            all.stats
                .played_this_week
                .iter()
                .all(|map| map.tier == Some(1))
        );
        assert!(all.stats.newest.iter().all(|map| map.tier == Some(1)));

        let filtered: MapList = test_client::get(&db, "/v1/maps?tier=2").await.json();
        let expected: Vec<_> = (5..10)
            .map(|index| format!("bhop_tier_{index:02}"))
            .collect();
        assert_eq!(filtered.stats.tier, Some(2));
        assert_eq!(
            (filtered.stats.maps, filtered.stats.by_tier),
            (12, vec![5, 7])
        );
        assert_eq!(filtered.stats.played_this_week.len(), 5);
        assert_eq!(filtered.stats.newest.len(), 5);
        for (index, map) in filtered.stats.played_this_week.iter().enumerate() {
            assert_eq!(map.name, expected[index]);
            assert_eq!((map.tier, map.players), (Some(2), 1));
        }
        for (index, map) in filtered.stats.newest.iter().enumerate() {
            assert_eq!(map.name, expected[index]);
            assert_eq!(map.tier, Some(2));
        }
    }

    #[sqlx::test]
    async fn sorts_by_record_and_filters_by_completion(db: PgPool) {
        let key = setup(&db).await;
        let second = json!({ "steamid64": "76561197960287931", "name": "second" });
        let mut beaten = run("b", 25.0);
        beaten["player"] = second.clone();
        let mut arcane = run("c", 10.0);
        arcane["map"] = json!("bhop_arcane");
        arcane["finished_at"] = json!(1_792_500_000);
        let mut candy = run("d", 40.0);
        candy["map"] = json!("bhop_candy");
        candy["player"] = second;
        candy["finished_at"] = json!(1_792_450_000);
        for body in [&run("a", 30.0), &beaten, &arcane, &candy] {
            let status = test_client::post(&db, "/v1/runs", Some(&key), body)
                .await
                .status;
            assert_eq!(status, 201);
        }

        // Records: bhop_arcane 10.0 (newest), bhop_badges 25.0 (oldest), bhop_candy 40.0.
        for (sort, expected) in [
            (
                "longest_record",
                ["bhop_candy", "bhop_badges", "bhop_arcane"],
            ),
            (
                "shortest_record",
                ["bhop_arcane", "bhop_badges", "bhop_candy"],
            ),
            (
                "newest_record",
                ["bhop_arcane", "bhop_candy", "bhop_badges"],
            ),
            (
                "oldest_record",
                ["bhop_badges", "bhop_candy", "bhop_arcane"],
            ),
            ("name_desc", ["bhop_candy", "bhop_badges", "bhop_arcane"]),
            (
                "least_popular",
                ["bhop_arcane", "bhop_candy", "bhop_badges"],
            ),
        ] {
            assert_eq!(
                names(&db, &format!("/v1/maps?sort={sort}")).await,
                expected,
                "{sort}"
            );
        }

        // gabe, as a SteamID2: finished bhop_arcane and bhop_badges, not bhop_candy.
        let done: MapList = test_client::get(&db, "/v1/maps?player=STEAM_0:0:11101&completed=true")
            .await
            .json();
        assert_eq!(done.total, 2);
        assert_eq!((done.completed, done.stats.maps), (Some(2), 3));
        assert_eq!(done.player.map(|p| p.name).as_deref(), Some("gabe"));
        assert_eq!(
            names(&db, "/v1/maps?player=76561197960287930&completed=false").await,
            ["bhop_candy"]
        );
        // Somebody who never played has completed nothing.
        let stranger: MapList =
            test_client::get(&db, "/v1/maps?player=76561197960287999&completed=false")
                .await
                .json();
        assert_eq!((stranger.total, stranger.player.is_none()), (3, true));
        assert_eq!(
            test_client::get(&db, "/v1/maps?completed=true")
                .await
                .status,
            422
        );
        assert_eq!(
            test_client::get(&db, "/v1/maps?player=gabe").await.status,
            422
        );
    }

    #[sqlx::test]
    async fn searches_put_the_closest_names_first(db: PgPool) {
        let key = setup(&db).await;
        for (id, map) in [
            ("a", "bhop_xcandy"),
            ("b", "bhop_candy_saarc"),
            ("c", "candy"),
        ] {
            let mut body = run(id, 30.0);
            body["map"] = json!(map);
            test_client::post(&db, "/v1/runs", Some(&key), &body).await;
        }

        assert_eq!(
            names(&db, "/v1/maps?q=candy").await,
            ["candy", "bhop_candy_saarc", "bhop_xcandy"]
        );
        assert_eq!(
            names(&db, "/v1/maps?q=Candy%20%20Saarc").await,
            ["bhop_candy_saarc", "candy"]
        );
        // A typo still finds it, after any real match.
        assert_eq!(
            names(&db, "/v1/maps?q=bhop_candy_sarc")
                .await
                .first()
                .map(String::as_str),
            Some("bhop_candy_saarc")
        );
    }

    #[sqlx::test]
    async fn tiers_show_once_a_tier_count_is_published(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let map = crate::maps::MapName::try_from("bhop_badges".to_owned()).unwrap();

        assert!(
            crate::staff::maps::set_tier(&db, None, &map, 0, 2)
                .await
                .is_err()
        );
        let tiers = crate::policies::Policy::Tiers(crate::policies::TiersPolicy { count: 3 });
        crate::policies::publish(&mut db.acquire().await.unwrap(), &tiers)
            .await
            .unwrap();
        assert!(
            crate::staff::maps::set_tier(&db, None, &map, 0, 4)
                .await
                .is_err()
        );
        crate::staff::maps::set_tier(&db, None, &map, 0, 2)
            .await
            .unwrap();
        crate::staff::maps::set_tier(&db, None, &map, 0, 3)
            .await
            .unwrap();

        let list: MapList = test_client::get(&db, "/v1/maps").await.json();
        assert_eq!(list.tier_count, Some(3));
        assert_eq!(list.maps[0].tier, Some(3));
        assert_eq!((list.stats.maps, list.stats.by_tier), (1, vec![0, 0, 1]));

        // Tier sorts go either way and keep maps without a tier last.
        for (name, finished_at) in [
            ("bhop_arcane", 1_792_500_000),
            ("bhop_cobblestone", 1_792_500_100),
        ] {
            let mut other = run(name, 10.0);
            other["map"] = json!(name);
            other["finished_at"] = json!(finished_at);
            test_client::post(&db, "/v1/runs", Some(&key), &other).await;
        }
        let arcane = crate::maps::MapName::try_from("bhop_arcane".to_owned()).unwrap();
        crate::staff::maps::set_tier(&db, None, &arcane, 0, 1)
            .await
            .unwrap();
        assert_eq!(
            names(&db, "/v1/maps?sort=hardest").await,
            ["bhop_badges", "bhop_arcane", "bhop_cobblestone"]
        );
        assert_eq!(
            names(&db, "/v1/maps?sort=easiest").await,
            ["bhop_arcane", "bhop_badges", "bhop_cobblestone"]
        );

        // A tier filter keeps only that tier, and counts only it; the totals stay the whole list's.
        let tier_one: MapList = test_client::get(&db, "/v1/maps?tier=1").await.json();
        assert_eq!(tier_one.total, 1);
        assert_eq!(tier_one.maps[0].name, "bhop_arcane");
        assert_eq!(tier_one.stats.maps, 3);
    }
}
