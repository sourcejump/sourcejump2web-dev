//! Staff tools for maps: tiers per track, the description and the release (`manage_maps`), and zone sets
//! (`manage_zones`).
//! Pictures are in `staff/map_images.rs`.
//!
//! Tiers and zone sets are append-only, like other policy: a change is a new row, the newest is in force,
//! and older ones are the history shown here. The command line sets tiers, images and zones through the
//! functions here too, so every change is logged.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, types::Json as JsonColumn};
use utoipa::{IntoParams, ToSchema};

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction, check_reason},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    maps::{
        self, MapName, image,
        release::{Release, ReleaseDate},
        viewer_file::{self, ViewerFile},
    },
    name_search,
    players::{PlayerRef, SteamId64, privileges::Privilege, steam_profile},
    zones::{self, Zone},
};

pub(super) const NO_MAP: ChangeError = ChangeError::NotFound("SourceJump has no such map");
const MAX_TRACK: i16 = 100;
const PAGE_SIZE: i64 = 50;

/// Rates a map's track. The tier must fit the published tier count.
pub async fn set_tier(
    db: &PgPool,
    actor: Option<SteamId64>,
    map: &MapName,
    track: i16,
    tier: i16,
) -> Result<(), ChangeError> {
    if !(0..=MAX_TRACK).contains(&track) {
        return Err(ChangeError::Invalid(format!(
            "the track is 0 to {MAX_TRACK}"
        )));
    }
    let mut tx = db.begin().await?;
    let count = sqlx::query_scalar!(
        r#"SELECT (value->>'count')::smallint AS count FROM policies WHERE name = 'tiers' ORDER BY version DESC LIMIT 1"#
    )
    .fetch_optional(&mut *tx)
    .await?
    .flatten()
    .ok_or_else(|| ChangeError::Invalid("publish a tier count on the rules page first".to_owned()))?;
    if !(1..=count).contains(&tier) {
        return Err(ChangeError::Invalid(format!("the tier is 1 to {count}")));
    }
    let map_id = sqlx::query_scalar!("SELECT id FROM maps WHERE name = $1", map.as_str())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(NO_MAP)?;
    let in_force = sqlx::query_scalar!(
        r#"SELECT tier AS "tier!" FROM current_map_tiers WHERE map_id = $1 AND track = $2"#,
        map_id,
        track
    )
    .fetch_optional(&mut *tx)
    .await?;
    if in_force == Some(tier) {
        return Err(ChangeError::Unchanged);
    }
    sqlx::query!(
        "INSERT INTO map_tiers (map_id, track, tier, assigned_by) VALUES ($1, $2, $3, $4)",
        map_id,
        track,
        tier,
        actor.map(SteamId64::get)
    )
    .execute(&mut *tx)
    .await?;
    crate::leaderboards::standings::refresh_track(&mut tx, map_id, track).await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::SetTier,
        target: map.as_str(),
        reason: None,
        detail: json!({ "track": track, "tier": tier }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

const MAX_DESCRIPTION_CHARS: usize = 1000;

/// Sets or clears the map's public description, plain text.
pub async fn set_description(
    db: &PgPool,
    actor: Option<SteamId64>,
    map: &MapName,
    description: Option<&str>,
) -> Result<(), ChangeError> {
    let description = description.map(str::trim).filter(|text| !text.is_empty());
    if description.is_some_and(|text| text.chars().count() > MAX_DESCRIPTION_CHARS) {
        return Err(ChangeError::Invalid(format!(
            "the description is at most {MAX_DESCRIPTION_CHARS} characters"
        )));
    }
    let mut tx = db.begin().await?;
    let current = sqlx::query_scalar!(
        "SELECT description FROM maps WHERE name = $1 FOR UPDATE",
        map.as_str()
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(NO_MAP)?;
    if current.as_deref() == description {
        return Err(ChangeError::Unchanged);
    }
    sqlx::query!(
        "UPDATE maps SET description = $2 WHERE name = $1",
        map.as_str(),
        description
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::SetMapDescription,
        target: map.as_str(),
        reason: None,
        detail: json!({ "description": description }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

/// Sets when the map was released and who made it; None for either means unknown. A mapper who hasn't played
/// gets a player row, so their name links to a profile; the caller fetches their Steam profile for its name.
pub async fn set_release(
    db: &PgPool,
    actor: Option<SteamId64>,
    map: &MapName,
    released: Option<ReleaseDate>,
    mapper: Option<SteamId64>,
) -> Result<(), ChangeError> {
    if let Some(released) = released {
        released.check().map_err(ChangeError::Invalid)?;
    }
    let mut tx = db.begin().await?;
    let current = sqlx::query!(
        "SELECT released_year, released_month, released_day, mapper_steamid64 FROM maps WHERE name = $1 FOR UPDATE",
        map.as_str()
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(NO_MAP)?;
    let current_release = ReleaseDate::from_columns(
        current.released_year,
        current.released_month,
        current.released_day,
    );
    if current_release == released && current.mapper_steamid64 == mapper.map(SteamId64::get) {
        return Err(ChangeError::Unchanged);
    }
    if let Some(mapper) = mapper {
        sqlx::query!(
            "INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1::bigint, $1::bigint::text, '-infinity')
             ON CONFLICT (steamid64) DO NOTHING",
            mapper.get()
        )
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query!(
        "UPDATE maps SET released_year = $2, released_month = $3, released_day = $4, mapper_steamid64 = $5
         WHERE name = $1",
        map.as_str(),
        released.map(|date| date.year),
        released.and_then(|date| date.month),
        released.and_then(|date| date.day),
        mapper.map(SteamId64::get)
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::SetMapRelease,
        target: map.as_str(),
        reason: None,
        detail: json!({ "released": released, "mapper": mapper.map(|id| id.to_string()) }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

/// Publishes a zone set as the map's version after `based_on` (None: its first). A map SourceJump hasn't
/// seen yet is added, so zones can be ready before anyone runs it.
pub async fn publish_zones(
    db: &PgPool,
    actor: Option<SteamId64>,
    map: &MapName,
    based_on: Option<i32>,
    zone_set: &[Zone],
    note: Option<&str>,
) -> Result<i32, ChangeError> {
    zones::check(zone_set).map_err(ChangeError::Invalid)?;
    let mut tx = db.begin().await?;
    let map_id = maps::id_for(&mut tx, map).await?;
    let current = sqlx::query!(
        r#"SELECT version, zones AS "zones: JsonColumn<Vec<Zone>>" FROM map_zones WHERE map_id = $1 ORDER BY version DESC LIMIT 1"#,
        map_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if current.as_ref().map(|row| row.version) != based_on {
        return Err(ChangeError::Stale);
    }
    if current.is_some_and(|row| row.zones.0 == zone_set) {
        return Err(ChangeError::Unchanged);
    }
    let version = based_on.unwrap_or(0) + 1;
    sqlx::query!(
        "INSERT INTO map_zones (map_id, version, zones) VALUES ($1, $2, $3)",
        map_id,
        version,
        JsonColumn(zone_set) as _
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::PublishZones,
        target: map.as_str(),
        reason: note,
        detail: json!({ "version": version }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(version)
}

pub(super) fn map_name(map: String) -> Result<MapName, ApiError> {
    MapName::try_from(map).map_err(ApiError::Invalid)
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct StaffMapsQuery {
    /// Part of a map name.
    q: Option<String>,
    /// Maps to skip, for paging. Default 0.
    offset: Option<i64>,
    /// Only maps nobody has finished a run on yet: zoned, or not yet zoned.
    no_runs: Option<bool>,
}

/// A map as the staff list shows it, including maps with zones but no runs yet.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffMapRow {
    pub name: String,
    pub image: Option<image::MapImage>,
    /// The main track's tier in force.
    pub tier: Option<i16>,
    /// The zone set version in force; none without zones.
    pub zone_version: Option<i32>,
    pub last_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffMapList {
    /// By name, 50 at a time.
    pub maps: Vec<StaffMapRow>,
    /// Maps matching the search.
    pub total: i64,
}

/// Every map SourceJump knows, for staff with `manage_maps` or `manage_zones`.
#[utoipa::path(
    get,
    path = "/v1/staff/maps",
    tag = "staff",
    params(StaffMapsQuery),
    responses(
        (status = OK, body = StaffMapList),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps or manage_zones", body = ErrorBody),
    ),
)]
pub async fn list_staff_maps(
    State(state): State<AppState>,
    staff: Staff,
    Query(query): Query<StaffMapsQuery>,
) -> Result<Json<StaffMapList>, ApiError> {
    staff.require_any(&[Privilege::ManageMaps, Privilege::ManageZones])?;
    let pattern = name_search::contains_pattern(query.q.unwrap_or_default().trim());
    let offset = query.offset.unwrap_or(0).max(0);
    let no_runs = query.no_runs.unwrap_or(false);
    let rows = sqlx::query!(
        r#"
        SELECT m.name, ci.id AS "image_id?", ci.key AS "image_key?", ci.focus AS "image_focus?", m.last_run_at,
               (SELECT tier FROM current_map_tiers t WHERE t.map_id = m.id AND t.track = 0) AS tier,
               (SELECT max(version) FROM map_zones z WHERE z.map_id = m.id) AS zone_version
        FROM maps m
        LEFT JOIN map_images ci ON ci.map_id = m.id AND ci.position = 0
        WHERE m.name ILIKE $1 ESCAPE '\' AND (NOT $4 OR m.last_run_at IS NULL)
        ORDER BY m.name
        LIMIT $2 OFFSET $3
        "#,
        pattern,
        PAGE_SIZE,
        offset,
        no_runs
    )
    .fetch_all(&state.db)
    .await?;
    let maps = rows
        .into_iter()
        .map(|row| StaffMapRow {
            image: image::MapImage::cover(
                &state.storage,
                row.image_id,
                row.image_key,
                row.image_focus,
            ),
            name: row.name,
            tier: row.tier,
            zone_version: row.zone_version,
            last_run_at: row.last_run_at,
        })
        .collect();
    let total = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM maps WHERE name ILIKE $1 ESCAPE '\' AND (NOT $2 OR last_run_at IS NULL)"#,
        pattern,
        no_runs
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(StaffMapList { maps, total }))
}

/// One map, everything staff can change about it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffMap {
    pub name: String,
    /// False for a map SourceJump hasn't seen: no runs and no zones. Publishing zones adds it.
    pub known: bool,
    pub has_runs: bool,
    /// Up to 10, in order; the first is the cover.
    pub images: Vec<image::MapImage>,
    pub description: Option<String>,
    /// When it was released, as precisely as staff know; none when unknown.
    pub released: Option<ReleaseDate>,
    /// Who made it; none when unknown.
    pub mapper: Option<PlayerRef>,
    /// The `tiers` policy's count; none until it's published.
    pub tier_count: Option<i16>,
    /// Every track with runs, a tier or zones, main first.
    pub tracks: Vec<StaffTrack>,
    /// Newest first; the first is in force.
    pub zone_sets: Vec<ZoneSetVersion>,
    /// The map stripped for the zone editor's 3D view. None until it has been made.
    pub viewer_file: Option<ViewerFile>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffTrack {
    pub track: i16,
    pub tier: Option<i16>,
    /// Newest first.
    pub history: Vec<TierAssignment>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TierAssignment {
    pub tier: i16,
    pub assigned_at: DateTime<Utc>,
    /// None from the command line.
    pub assigned_by: Option<PlayerRef>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ZoneSetVersion {
    pub version: i32,
    pub published_at: DateTime<Utc>,
    pub published_by: Option<PlayerRef>,
    pub note: Option<String>,
    pub zones: Vec<Zone>,
}

/// A map's tiers, image and zone sets. Answers for any valid map name, so staff can prepare a new map.
#[utoipa::path(
    get,
    path = "/v1/staff/maps/{map}",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    responses(
        (status = OK, body = StaffMap),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps or manage_zones", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name", body = ErrorBody),
    ),
)]
pub async fn get_staff_map(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
) -> Result<Json<StaffMap>, ApiError> {
    staff.require_any(&[Privilege::ManageMaps, Privilege::ManageZones])?;
    let map = map_name(map)?;
    let tier_count = crate::maps::tiers::tier_count(&state.db).await?;
    let row = sqlx::query!(
        r#"
        SELECT id, description, last_run_at IS NOT NULL AS "has_runs!" FROM maps WHERE name = $1
        "#,
        map.as_str()
    )
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Ok(Json(StaffMap {
            name: map.as_str().to_owned(),
            known: false,
            has_runs: false,
            images: Vec::new(),
            description: None,
            released: None,
            mapper: None,
            tier_count,
            tracks: vec![StaffTrack {
                track: 0,
                tier: None,
                history: Vec::new(),
            }],
            zone_sets: Vec::new(),
            viewer_file: None,
        }));
    };

    let zone_sets = zone_set_versions(&state.db, row.id, &map).await?;
    let tracks = tracks(&state.db, row.id, zone_sets.first()).await?;
    let release = Release::of_map(&state.db, row.id).await?;

    Ok(Json(StaffMap {
        name: map.as_str().to_owned(),
        known: true,
        has_runs: row.has_runs,
        images: image::images_of(&state.db, &state.storage, row.id).await?,
        description: row.description,
        released: release.date,
        mapper: release.mapper,
        tier_count,
        tracks,
        zone_sets,
        viewer_file: viewer_file::of_map(&state.db, &state.storage, row.id).await?,
    }))
}

/// The map's zone sets, newest first, with who published each and their note.
async fn zone_set_versions(
    db: &PgPool,
    map_id: i64,
    map: &MapName,
) -> Result<Vec<ZoneSetVersion>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT z.version, z.published_at, z.zones AS "zones: JsonColumn<Vec<Zone>>",
               l.reason AS "note?",
               p.steamid64::text AS "by_steamid64?", p.name AS "by_name?",
               p.avatar_url AS by_avatar_url, p.country_code AS by_country_code
        FROM map_zones z
        LEFT JOIN staff_log l ON l.action = 'publish_zones' AND l.target = $2
            AND l.detail->>'version' = z.version::text
        LEFT JOIN players p ON p.steamid64 = l.actor_steamid64
        WHERE z.map_id = $1
        ORDER BY z.version DESC
        "#,
        map_id,
        map.as_str()
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|z| ZoneSetVersion {
            version: z.version,
            published_at: z.published_at,
            published_by: PlayerRef::joined(
                z.by_steamid64,
                z.by_name,
                z.by_avatar_url,
                z.by_country_code,
            ),
            note: z.note,
            zones: z.zones.0,
        })
        .collect())
}

/// Every track with runs, a tier or zones in force, main first, with its tier history.
async fn tracks(
    db: &PgPool,
    map_id: i64,
    latest_zones: Option<&ZoneSetVersion>,
) -> Result<Vec<StaffTrack>, sqlx::Error> {
    let assignments = sqlx::query!(
        r#"
        SELECT t.track, t.tier, t.assigned_at,
               p.steamid64::text AS "by_steamid64?", p.name AS "by_name?",
               p.avatar_url AS by_avatar_url, p.country_code AS by_country_code
        FROM map_tiers t LEFT JOIN players p ON p.steamid64 = t.assigned_by
        WHERE t.map_id = $1
        ORDER BY t.track, t.assigned_at DESC
        "#,
        map_id
    )
    .fetch_all(db)
    .await?;
    let run_tracks: Vec<i16> =
        sqlx::query_scalar!("SELECT DISTINCT track FROM runs WHERE map_id = $1", map_id)
            .fetch_all(db)
            .await?;

    let mut track_numbers: Vec<i16> = run_tracks;
    track_numbers.push(0);
    track_numbers.extend(assignments.iter().map(|a| a.track));
    if let Some(latest) = latest_zones {
        track_numbers.extend(
            latest
                .zones
                .iter()
                .filter_map(|z| i16::try_from(z.track).ok()),
        );
    }
    track_numbers.sort_unstable();
    track_numbers.dedup();
    Ok(track_numbers
        .into_iter()
        .map(|track| {
            let history: Vec<TierAssignment> = assignments
                .iter()
                .filter(|a| a.track == track)
                .map(|a| TierAssignment {
                    tier: a.tier,
                    assigned_at: a.assigned_at,
                    assigned_by: PlayerRef::joined(
                        a.by_steamid64.clone(),
                        a.by_name.clone(),
                        a.by_avatar_url.clone(),
                        a.by_country_code.clone(),
                    ),
                })
                .collect();
            StaffTrack {
                track,
                tier: history.first().map(|a| a.tier),
                history,
            }
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SetTierRequest {
    /// 1 to the tier count.
    pub tier: i16,
}

/// Rate one of the map's tracks.
#[utoipa::path(
    put,
    path = "/v1/staff/maps/{map}/tiers/{track}",
    tag = "staff",
    params(
        ("map" = String, Path, description = "Map name"),
        ("track" = i16, Path, description = "0 for the main track, 1 and up for bonuses"),
    ),
    request_body = SetTierRequest,
    responses(
        (status = NO_CONTENT, description = "Set"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "No tier count, out of range, or unchanged", body = ErrorBody),
    ),
)]
pub async fn put_tier(
    State(state): State<AppState>,
    staff: Staff,
    Path((map, track)): Path<(String, i16)>,
    JsonBody(request): JsonBody<SetTierRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageMaps)?;
    set_tier(
        &state.db,
        Some(staff.steamid64),
        &map_name(map)?,
        track,
        request.tier,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DescriptionRequest {
    /// Plain text, up to 1000 characters; null or blank clears it.
    pub description: Option<String>,
}

/// Set or clear the map's public description.
#[utoipa::path(
    put,
    path = "/v1/staff/maps/{map}/description",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    request_body = DescriptionRequest,
    responses(
        (status = NO_CONTENT, description = "Set"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Too long, or unchanged", body = ErrorBody),
    ),
)]
pub async fn put_description(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
    JsonBody(request): JsonBody<DescriptionRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageMaps)?;
    set_description(
        &state.db,
        Some(staff.steamid64),
        &map_name(map)?,
        request.description.as_deref(),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ReleaseRequest {
    /// When it was released, as precisely as staff know: a year, a month or a day, not in the future; null
    /// when unknown.
    pub released: Option<ReleaseDate>,
    /// Who made it, as a `SteamID` in any form staff paste (`SteamID64`, `STEAM_0:1:2`, `[U:1:4]`); null when
    /// unknown.
    pub mapper: Option<String>,
}

/// Set when the map was released and who made it, shown under its name.
#[utoipa::path(
    put,
    path = "/v1/staff/maps/{map}/release",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    request_body = ReleaseRequest,
    responses(
        (status = NO_CONTENT, description = "Set"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID, not a past date, or unchanged", body = ErrorBody),
    ),
)]
pub async fn put_release(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
    JsonBody(request): JsonBody<ReleaseRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageMaps)?;
    let map = map_name(map)?;
    let mapper = request
        .mapper
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| {
            SteamId64::parse_any(text)
                .ok_or_else(|| ApiError::Invalid(format!("{text:?} is not a SteamID")))
        })
        .transpose()?;
    set_release(
        &state.db,
        Some(staff.steamid64),
        &map,
        request.released,
        mapper,
    )
    .await?;
    if let Some(mapper) = mapper {
        // A mapper new to SourceJump is known only by their ID until Steam gives a name.
        let fetched_at = sqlx::query_scalar!(
            "SELECT steam_profile_fetched_at FROM players WHERE steamid64 = $1",
            mapper.get()
        )
        .fetch_one(&state.db)
        .await?;
        steam_profile::refresh_if_stale(state.db.clone(), state.steam.clone(), mapper, fetched_at);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// The staff log's entries about one map, newest first: tiers, image, banner, description and zones. Any
/// staff member may read it, as the whole log.
#[utoipa::path(
    get,
    path = "/v1/staff/maps/{map}/log",
    tag = "staff",
    params(("map" = String, Path, description = "Map name"), log::EntriesQuery),
    responses(
        (status = OK, body = log::LogEntries),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not staff", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name", body = ErrorBody),
    ),
)]
pub async fn get_map_log(
    State(state): State<AppState>,
    _staff: Staff,
    Path(map): Path<String>,
    Query(query): Query<log::EntriesQuery>,
) -> Result<Json<log::LogEntries>, ApiError> {
    let map = map_name(map)?;
    Ok(Json(
        log::map_entries(&state.db, &map, query.before()?).await?,
    ))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PublishZonesRequest {
    /// The version this was based on; null for the map's first zone set.
    pub based_on: Option<i32>,
    /// The whole set, as shavit-zones-json reads it.
    pub zones: Vec<Zone>,
    /// What changed and why, for the staff log. 1 to 500 characters.
    pub note: String,
}

/// The version a publish created.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Published {
    pub version: i32,
}

/// Publish a zone set as the map's next version. Servers load it on their next map start.
#[utoipa::path(
    post,
    path = "/v1/staff/maps/{map}/zones",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    request_body = PublishZonesRequest,
    responses(
        (status = CREATED, body = Published),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_zones, from SourceJump's pages", body = ErrorBody),
        (status = CONFLICT, description = "A newer zone set was published since `based_on`", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a usable zone set, unchanged, or no note", body = ErrorBody),
    ),
)]
pub async fn post_zones(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
    JsonBody(request): JsonBody<PublishZonesRequest>,
) -> Result<(StatusCode, Json<Published>), ApiError> {
    staff.require(Privilege::ManageZones)?;
    let note = check_reason(&request.note)?;
    let version = publish_zones(
        &state.db,
        Some(staff.steamid64),
        &map_name(map)?,
        request.based_on,
        &request.zones,
        Some(&note),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(Published { version })))
}

#[cfg(test)]
pub(crate) mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::*;
    use crate::{
        auth::sessions,
        players::privileges::{self, Privileges},
        policies::{self, Policy, TiersPolicy},
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287930";
    const OTHER: &str = "76561197960287931";

    pub(crate) async fn session(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn send(
        db: &PgPool,
        method: &str,
        path: &str,
        token: &str,
        body: Option<Value>,
    ) -> TestResponse {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("content-type", "application/json")
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
            .unwrap();
        test_client::send(db, request).await
    }

    fn zone_set(end_x: f64) -> Value {
        json!([
            { "type": "start", "track": 0, "id": 1, "point_a": [0.0, 0.0, 0.0], "point_b": [64.0, 64.0, 64.0] },
            { "type": "end", "track": 0, "id": 2, "point_a": [end_x, 0.0, 0.0], "point_b": [1064.0, 64.0, 64.0] },
            { "type": "start", "track": 1, "id": 3, "point_a": [0.0, 500.0, 0.0], "point_b": [64.0, 564.0, 64.0] },
        ])
    }

    #[sqlx::test]
    async fn staff_publish_zones_for_a_new_map(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageZones]).await;
        let fresh: StaffMap = send(&db, "GET", "/v1/staff/maps/bhop_fresh", &token, None)
            .await
            .json();
        assert!(!fresh.known && fresh.zone_sets.is_empty());

        let first =
            json!({ "based_on": null, "zones": zone_set(1000.0), "note": "From the WR server" });
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/maps/bhop_fresh/zones",
                &token,
                Some(first.clone())
            )
            .await
            .status,
            201
        );
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/maps/bhop_fresh/zones",
                &token,
                Some(first)
            )
            .await
            .status,
            409
        );
        let same = json!({ "based_on": 1, "zones": zone_set(1000.0), "note": "Again" });
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/maps/bhop_fresh/zones",
                &token,
                Some(same)
            )
            .await
            .status,
            422
        );
        let moved = json!({ "based_on": 1, "zones": zone_set(990.0), "note": "End zone fix" });
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/maps/bhop_fresh/zones",
                &token,
                Some(moved)
            )
            .await
            .status,
            201
        );

        let served: Value = test_client::get(&db, "/v1/maps/bhop_fresh/zones")
            .await
            .json();
        assert_eq!(served, zone_set(990.0));
        let map: StaffMap = send(&db, "GET", "/v1/staff/maps/bhop_fresh", &token, None)
            .await
            .json();
        assert!(map.known && !map.has_runs);
        let versions: Vec<_> = map
            .zone_sets
            .iter()
            .map(|z| (z.version, z.note.as_deref()))
            .collect();
        assert_eq!(
            versions,
            [(2, Some("End zone fix")), (1, Some("From the WR server"))]
        );
        // The bonus start in the zones makes track 1 one of the map's tracks.
        assert_eq!(
            map.tracks.iter().map(|t| t.track).collect::<Vec<_>>(),
            [0, 1]
        );

        let broken = json!({ "based_on": 2, "zones": [{ "type": "start", "track": 0, "id": 1 }], "note": "No end" });
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/maps/bhop_fresh/zones",
                &token,
                Some(broken)
            )
            .await
            .status,
            422
        );
    }

    #[sqlx::test]
    async fn staff_set_and_clear_a_maps_description(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageMaps, Privilege::ManageZones]).await;
        let path = "/v1/staff/maps/bhop_fresh/description";
        let put = |description: Value| {
            send(
                &db,
                "PUT",
                path,
                &token,
                Some(json!({ "description": description })),
            )
        };
        assert_eq!(put(json!("Short and fast")).await.status, 404);
        let zones = json!({ "based_on": null, "zones": zone_set(1000.0), "note": "First" });
        send(
            &db,
            "POST",
            "/v1/staff/maps/bhop_fresh/zones",
            &token,
            Some(zones),
        )
        .await;

        assert_eq!(put(json!("  Short and fast ")).await.status, 204);
        assert_eq!(put(json!("Short and fast")).await.status, 422, "unchanged");
        assert_eq!(put(json!("a".repeat(1001))).await.status, 422, "too long");
        let public: Value = test_client::get(&db, "/v1/maps/bhop_fresh").await.json();
        assert_eq!(public["description"], "Short and fast", "trimmed");

        assert_eq!(put(json!(" ")).await.status, 204, "blank clears it");
        let public: Value = test_client::get(&db, "/v1/maps/bhop_fresh").await.json();
        assert_eq!(public["description"], Value::Null);
        let logged = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM staff_log WHERE action = 'set_map_description'"#
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(logged, 2);
    }

    #[sqlx::test]
    async fn staff_set_when_a_map_was_released_and_who_made_it(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageMaps, Privilege::ManageZones]).await;
        let path = "/v1/staff/maps/bhop_fresh/release";
        let release = json!({ "released": { "year": 2012, "month": 5 }, "mapper": "STEAM_0:1:2" });
        let put = |body: Value| send(&db, "PUT", path, &token, Some(body));
        assert_eq!(put(release.clone()).await.status, 404);
        let zones = json!({ "based_on": null, "zones": zone_set(1000.0), "note": "First" });
        send(
            &db,
            "POST",
            "/v1/staff/maps/bhop_fresh/zones",
            &token,
            Some(zones),
        )
        .await;

        assert_eq!(put(release.clone()).await.status, 204);
        assert_eq!(put(release).await.status, 422, "unchanged");
        assert_eq!(
            put(json!({ "released": { "year": 2999 }, "mapper": null }))
                .await
                .status,
            422
        );
        assert_eq!(
            put(json!({ "released": null, "mapper": "nobody" }))
                .await
                .status,
            422
        );

        // STEAM_0:1:2 is account 5. They've never played, so their ID stands in for a name.
        let mapper = "76561197960265733";
        let staff_map: StaffMap = send(&db, "GET", "/v1/staff/maps/bhop_fresh", &token, None)
            .await
            .json();
        let may_2012 = ReleaseDate {
            year: 2012,
            month: Some(5),
            day: None,
        };
        assert_eq!(staff_map.released, Some(may_2012));
        let named = staff_map.mapper.unwrap();
        assert_eq!(
            (named.steamid64.as_str(), named.name.as_str()),
            (mapper, mapper)
        );
        let public: Value = test_client::get(&db, "/v1/maps/bhop_fresh").await.json();
        assert_eq!(
            public["released"],
            json!({ "year": 2012, "month": 5, "day": null })
        );
        assert_eq!(public["mapper"]["steamid64"], mapper);

        assert_eq!(
            put(json!({ "released": null, "mapper": "" })).await.status,
            204
        );
        let cleared: StaffMap = send(&db, "GET", "/v1/staff/maps/bhop_fresh", &token, None)
            .await
            .json();
        assert!(cleared.released.is_none() && cleared.mapper.is_none());
        let logged = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM staff_log WHERE action = 'set_map_release'"#
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(logged, 2);
    }

    #[sqlx::test]
    async fn staff_set_tiers(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageMaps]).await;
        let map = MapName::try_from("bhop_badges".to_owned()).unwrap();
        maps::id_for(&mut db.acquire().await.unwrap(), &map)
            .await
            .unwrap();

        let tier = |tier: i16| json!({ "tier": tier });
        let path = "/v1/staff/maps/bhop_badges/tiers/0";
        // No tier count yet.
        assert_eq!(
            send(&db, "PUT", path, &token, Some(tier(2))).await.status,
            422
        );
        policies::publish(
            &mut db.acquire().await.unwrap(),
            &Policy::Tiers(TiersPolicy { count: 6 }),
        )
        .await
        .unwrap();
        assert_eq!(
            send(&db, "PUT", path, &token, Some(tier(7))).await.status,
            422
        );
        assert_eq!(
            send(&db, "PUT", path, &token, Some(tier(2))).await.status,
            204
        );
        assert_eq!(
            send(&db, "PUT", path, &token, Some(tier(2))).await.status,
            422
        );
        assert_eq!(
            send(&db, "PUT", path, &token, Some(tier(3))).await.status,
            204
        );
        assert_eq!(
            send(
                &db,
                "PUT",
                "/v1/staff/maps/bhop_nowhere/tiers/0",
                &token,
                Some(tier(3))
            )
            .await
            .status,
            404
        );

        let map: StaffMap = send(&db, "GET", "/v1/staff/maps/bhop_badges", &token, None)
            .await
            .json();
        assert_eq!(map.tracks[0].tier, Some(3));
        assert_eq!(map.tracks[0].history.len(), 2);
        assert_eq!(
            map.tracks[0].history[0]
                .assigned_by
                .as_ref()
                .unwrap()
                .steamid64,
            STAFF
        );

        let list: StaffMapList = send(&db, "GET", "/v1/staff/maps?q=BADG", &token, None)
            .await
            .json();
        assert_eq!(list.total, 1);
        assert_eq!(list.maps[0].tier, Some(3));
        // The full name matches, `_` included; `_` is a literal character, not a wildcard.
        for (search, total) in [("bhop_badges", 1), ("p_b", 1), ("bho__badges", 0)] {
            let list: StaffMapList = send(
                &db,
                "GET",
                &format!("/v1/staff/maps?q={search}"),
                &token,
                None,
            )
            .await
            .json();
            assert_eq!(list.total, total, "{search}");
        }

        let logged: Vec<String> = sqlx::query_scalar!("SELECT action FROM staff_log ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(logged, ["set_tier", "set_tier"]);
    }

    #[sqlx::test]
    async fn each_change_needs_its_own_privilege(db: PgPool) {
        let zones_only = session(&db, OTHER, &[Privilege::ManageZones]).await;
        assert_eq!(
            send(&db, "GET", "/v1/staff/maps", &zones_only, None)
                .await
                .status,
            200
        );
        let tier = json!({ "tier": 1 });
        assert_eq!(
            send(
                &db,
                "PUT",
                "/v1/staff/maps/bhop_a/tiers/0",
                &zones_only,
                Some(tier)
            )
            .await
            .status,
            403
        );
        // The description and the release are map details, like tiers: `manage_maps`, not `manage_zones`.
        for (path, body) in [
            (
                "/v1/staff/maps/bhop_a/description",
                json!({ "description": "Hijacked" }),
            ),
            (
                "/v1/staff/maps/bhop_a/release",
                json!({ "released": { "year": 2012 }, "mapper": null }),
            ),
        ] {
            assert_eq!(
                send(&db, "PUT", path, &zones_only, Some(body)).await.status,
                403,
                "{path}"
            );
        }

        let maps_only = session(&db, STAFF, &[Privilege::ManageMaps]).await;
        let body = json!({ "based_on": null, "zones": zone_set(1000.0), "note": "Sneaky" });
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/maps/bhop_a/zones",
                &maps_only,
                Some(body)
            )
            .await
            .status,
            403
        );

        let keys = session(&db, "76561197960287932", &[Privilege::ManageKeys]).await;
        assert_eq!(
            send(&db, "GET", "/v1/staff/maps", &keys, None).await.status,
            403
        );
    }
}
