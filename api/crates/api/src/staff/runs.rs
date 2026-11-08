//! Staff tools for run invalidation: one run, or every valid run of a player or server, and restoring them.
//! Needs `invalidate_runs`.
//!
//! Sensitive path, fails closed. Each change and its staff log entry are one transaction, and every
//! invalidation records which log entry took each run, so restoring a player's or server's invalidation brings
//! back exactly what it took. The ban and key tools invalidate through `invalidate_runs_of` here too, and
//! runs a banned player sends are stored invalid in their ban's name, so they're listed and restored here.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use utoipa::{IntoParams, ToSchema};

use super::{
    ChangeError,
    access::Staff,
    keys::server_detail,
    log::{self, StaffAction, check_reason, player_ref},
    players::parse_player,
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{PlayerRef, SteamId64, privileges::Privilege},
    runs::invalidation,
};

const NO_RUN: ChangeError = ChangeError::NotFound("SourceJump has no such run");
const OWN_RUNS: &str = "you can't invalidate or restore your own runs; ask another staff member";
const PAGE_SIZE: i64 = 50;

/// Whose runs a bulk invalidation takes.
#[derive(Debug, Clone, Copy)]
pub enum RunsOf {
    Player(SteamId64),
    /// A server, by ID: the runs sent with any key it has held.
    Server(i64),
}

/// What a bulk invalidation did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Invalidation {
    /// Its staff log entry, which restoring it names.
    pub log_id: i64,
    pub runs: i64,
}

/// Invalidates every valid run of a player or key on the caller's transaction, and logs it. None when there
/// was no valid run to take, in which case nothing is logged.
pub async fn invalidate_runs_of(
    conn: &mut PgConnection,
    actor: Option<SteamId64>,
    of: RunsOf,
    reason: Option<&str>,
) -> Result<Option<Invalidation>, sqlx::Error> {
    // Locked in ID order, so two invalidations over the same runs wait for each other instead of deadlocking.
    let run_ids = match of {
        RunsOf::Player(player) => {
            sqlx::query_scalar!(
                "SELECT id FROM runs WHERE player_steamid64 = $1 AND invalidated_at IS NULL
                 ORDER BY id FOR UPDATE",
                player.get()
            )
            .fetch_all(&mut *conn)
            .await?
        }
        RunsOf::Server(server_id) => {
            sqlx::query_scalar!(
                "SELECT r.id FROM runs r JOIN server_keys k ON k.id = r.key_id
                 WHERE k.server_id = $1 AND r.invalidated_at IS NULL
                 ORDER BY r.id FOR UPDATE OF r",
                server_id
            )
            .fetch_all(&mut *conn)
            .await?
        }
    };
    if run_ids.is_empty() {
        return Ok(None);
    }
    let runs = i64::try_from(run_ids.len()).expect("fewer runs than i64::MAX");
    let (action, target, detail) = match of {
        RunsOf::Player(player) => (
            StaffAction::InvalidatePlayerRuns,
            player.to_string(),
            json!({ "runs": runs }),
        ),
        RunsOf::Server(server_id) => {
            let mut detail = server_detail(conn, server_id).await?;
            detail["runs"] = json!(runs);
            (
                StaffAction::InvalidateServerRuns,
                server_id.to_string(),
                detail,
            )
        }
    };
    let entry = log::Entry {
        actor,
        action,
        target: &target,
        reason,
        detail,
    };
    let log_id = log::record(conn, entry).await?;
    invalidation::invalidate(conn, &run_ids, log_id).await?;
    Ok(Some(Invalidation { log_id, runs }))
}

/// Restores the runs a player's or key's invalidation (or a ban, for runs sent during it) took that are still
/// invalid, and logs it. Returns how many.
pub async fn restore_invalidation(
    db: &PgPool,
    actor: Option<SteamId64>,
    log_id: i64,
    reason: Option<&str>,
) -> Result<i64, ChangeError> {
    let mut tx = db.begin().await?;
    let invalidation = sqlx::query!(
        "SELECT target, detail FROM staff_log WHERE id = $1 AND action = ANY($2)",
        log_id,
        &[
            StaffAction::InvalidatePlayerRuns.name().to_owned(),
            StaffAction::InvalidateServerRuns.name().to_owned(),
            StaffAction::InvalidateKeyRuns.name().to_owned(),
            StaffAction::BanPlayer.name().to_owned(),
        ][..]
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound(
        "no player, server, key or ban invalidation has this ID",
    ))?;
    let taken = sqlx::query!(
        "SELECT id, player_steamid64 FROM runs WHERE invalidated_by = $1 ORDER BY id FOR UPDATE",
        log_id
    )
    .fetch_all(&mut *tx)
    .await?;
    if taken.is_empty() {
        return Err(ChangeError::Invalid(
            "every run it took is valid again".to_owned(),
        ));
    }
    // Staff never put their own runs back. Theirs stay invalid in this invalidation's name, so another staff
    // member restoring it later brings them back.
    let run_ids: Vec<i64> = taken
        .iter()
        .filter(|run| actor.is_none_or(|actor| actor.get() != run.player_steamid64))
        .map(|run| run.id)
        .collect();
    if run_ids.is_empty() {
        return Err(ChangeError::Invalid(OWN_RUNS.to_owned()));
    }
    let runs = i64::try_from(run_ids.len()).expect("fewer runs than i64::MAX");
    let mut detail = json!({ "invalidation": log_id, "runs": runs });
    // A server's or key's restore names the server as the invalidation recorded it, for the log to read.
    if let Some(server) = invalidation.detail.get("server") {
        detail["server"] = server.clone();
    }
    let entry = log::Entry {
        actor,
        action: StaffAction::RestoreRuns,
        target: &invalidation.target,
        reason,
        detail,
    };
    log::record(&mut tx, entry).await?;
    invalidation::restore(&mut tx, &run_ids).await?;
    tx.commit().await?;
    Ok(runs)
}

/// Invalidates one run and logs it.
pub async fn invalidate_run(
    db: &PgPool,
    actor: Option<SteamId64>,
    run_id: i64,
    reason: Option<&str>,
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let (invalidated, player, detail) = lock_run(&mut tx, run_id).await?.ok_or(NO_RUN)?;
    refuse_own(actor, player)?;
    if invalidated {
        return Err(ChangeError::Invalid(
            "this run is already invalidated".to_owned(),
        ));
    }
    let entry = log::Entry {
        actor,
        action: StaffAction::InvalidateRun,
        target: &run_id.to_string(),
        reason,
        detail,
    };
    let log_id = log::record(&mut tx, entry).await?;
    invalidation::invalidate(&mut tx, &[run_id], log_id).await?;
    tx.commit().await?;
    Ok(())
}

/// Restores one run, whichever action invalidated it, and logs it.
pub async fn restore_run(
    db: &PgPool,
    actor: Option<SteamId64>,
    run_id: i64,
    reason: Option<&str>,
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let (invalidated, player, detail) = lock_run(&mut tx, run_id).await?.ok_or(NO_RUN)?;
    refuse_own(actor, player)?;
    if !invalidated {
        return Err(ChangeError::Invalid(
            "this run isn't invalidated".to_owned(),
        ));
    }
    let entry = log::Entry {
        actor,
        action: StaffAction::RestoreRun,
        target: &run_id.to_string(),
        reason,
        detail,
    };
    log::record(&mut tx, entry).await?;
    invalidation::restore(&mut tx, &[run_id]).await?;
    tx.commit().await?;
    Ok(())
}

/// Staff don't act on their own runs, as they don't ban themselves or moderate their own posts.
fn refuse_own(actor: Option<SteamId64>, player: i64) -> Result<(), ChangeError> {
    if actor.is_some_and(|actor| actor.get() == player) {
        return Err(ChangeError::Invalid(OWN_RUNS.to_owned()));
    }
    Ok(())
}

/// Locks a run and returns whether it's invalidated and whose it is, with what the log says about it: who,
/// where and how fast, as it was then.
async fn lock_run(
    conn: &mut PgConnection,
    run_id: i64,
) -> Result<Option<(bool, i64, Value)>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT r.invalidated_at IS NOT NULL AS "invalidated!", r.player_steamid64,
               r.player_steamid64::text AS "player!",
               p.name AS player_name, m.name AS map, r.style, r.track, r.time
        FROM runs r
        JOIN players p ON p.steamid64 = r.player_steamid64
        JOIN maps m ON m.id = r.map_id
        WHERE r.id = $1
        FOR UPDATE OF r
        "#,
        run_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| {
        let detail = json!({
            "player": row.player,
            "player_name": row.player_name,
            "map": row.map,
            "style": row.style,
            "track": row.track,
            "time": row.time,
        });
        (row.invalidated, row.player_steamid64, detail)
    }))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunChangeRequest {
    /// Why, for the staff log. 1 to 500 characters; never shown publicly.
    pub reason: String,
}

/// Take a run off the boards. It keeps its page, which says it was invalidated; if it was a personal best,
/// the player's next fastest valid run takes its place.
#[utoipa::path(
    post,
    path = "/v1/staff/runs/{id}/invalidate",
    tag = "staff",
    params(("id" = i64, Path, description = "SourceJump's run ID")),
    request_body = RunChangeRequest,
    responses(
        (status = NO_CONTENT, description = "Invalidated"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs invalidate_runs, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such run", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Already invalidated, your own run, or no reason given", body = ErrorBody),
    ),
)]
pub async fn post_invalidate_run(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    JsonBody(request): JsonBody<RunChangeRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::InvalidateRuns)?;
    let reason = check_reason(&request.reason)?;
    invalidate_run(&state.db, Some(staff.steamid64), id, Some(&reason)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Put an invalidated run back on the boards, however it was invalidated.
#[utoipa::path(
    post,
    path = "/v1/staff/runs/{id}/restore",
    tag = "staff",
    params(("id" = i64, Path, description = "SourceJump's run ID")),
    request_body = RunChangeRequest,
    responses(
        (status = NO_CONTENT, description = "Restored"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs invalidate_runs, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such run", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not invalidated, your own run, or no reason given", body = ErrorBody),
    ),
)]
pub async fn post_restore_run(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    JsonBody(request): JsonBody<RunChangeRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::InvalidateRuns)?;
    let reason = check_reason(&request.reason)?;
    restore_run(&state.db, Some(staff.steamid64), id, Some(&reason)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The staff log's entries about one run, for its page: its own invalidations and restores, and what
/// invalidated it when that was a bulk invalidation or a ban. Any staff member may read it, as the whole log.
#[utoipa::path(
    get,
    path = "/v1/staff/runs/{id}/log",
    tag = "staff",
    params(("id" = i64, Path, description = "SourceJump's run ID"), log::EntriesQuery),
    responses(
        (status = OK, body = log::LogEntries),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not staff", body = ErrorBody),
        (status = NOT_FOUND, description = "No such run", body = ErrorBody),
    ),
)]
pub async fn get_run_log(
    State(state): State<AppState>,
    _staff: Staff,
    Path(id): Path<i64>,
    Query(query): Query<log::EntriesQuery>,
) -> Result<Json<log::LogEntries>, ApiError> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM runs WHERE id = $1) AS "exists!""#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(ApiError::NotFound("SourceJump has no such run"));
    }
    Ok(Json(
        log::run_entries(&state.db, id, query.before()?).await?,
    ))
}

/// Give `player` (any `SteamID` form) or `server` (its ID), not both.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InvalidateRunsRequest {
    pub player: Option<String>,
    pub server: Option<i64>,
    /// Why, for the staff log. 1 to 500 characters; never shown publicly.
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InvalidatedRuns {
    /// The invalidation's staff log entry, for restoring it.
    pub id: i64,
    pub runs: i64,
}

/// Take every valid run of a player, or every valid run sent with a key, off the boards.
#[utoipa::path(
    post,
    path = "/v1/staff/invalidations",
    tag = "staff",
    request_body = InvalidateRunsRequest,
    responses(
        (status = CREATED, body = InvalidatedRuns),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs invalidate_runs, from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Neither or both of player and key, yourself, no reason, or no valid runs", body = ErrorBody),
    ),
)]
pub async fn post_invalidation(
    State(state): State<AppState>,
    staff: Staff,
    JsonBody(request): JsonBody<InvalidateRunsRequest>,
) -> Result<(StatusCode, Json<InvalidatedRuns>), ApiError> {
    staff.require(Privilege::InvalidateRuns)?;
    let reason = check_reason(&request.reason)?;
    let of = runs_of(request.player.as_deref(), request.server)?;
    if let RunsOf::Player(player) = of {
        refuse_own(Some(staff.steamid64), player.get())?;
    }
    let mut tx = state.db.begin().await?;
    let done = invalidate_runs_of(&mut tx, Some(staff.steamid64), of, Some(&reason))
        .await?
        .ok_or_else(|| ApiError::Invalid("there are no valid runs to invalidate".to_owned()))?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(InvalidatedRuns {
            id: done.log_id,
            runs: done.runs,
        }),
    ))
}

fn runs_of(player: Option<&str>, server: Option<i64>) -> Result<RunsOf, ApiError> {
    match (player, server) {
        (Some(player), None) => SteamId64::parse_any(player.trim())
            .map(RunsOf::Player)
            .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID"))),
        (None, Some(server_id)) => Ok(RunsOf::Server(server_id)),
        _ => Err(ApiError::Invalid("give either player or server".to_owned())),
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RestoredRuns {
    pub runs: i64,
}

/// Put back the runs a player's or key's invalidation took that are still invalid. Runs restored or
/// invalidated separately since are left as they are.
#[utoipa::path(
    post,
    path = "/v1/staff/invalidations/{id}/restore",
    tag = "staff",
    params(("id" = i64, Path, description = "The invalidation's staff log entry")),
    request_body = RunChangeRequest,
    responses(
        (status = OK, body = RestoredRuns),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs invalidate_runs, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No player or key invalidation has this ID", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Nothing left to restore but your own runs, or no reason given", body = ErrorBody),
    ),
)]
pub async fn post_restore_invalidation(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    JsonBody(request): JsonBody<RunChangeRequest>,
) -> Result<Json<RestoredRuns>, ApiError> {
    staff.require(Privilege::InvalidateRuns)?;
    let reason = check_reason(&request.reason)?;
    let runs = restore_invalidation(&state.db, Some(staff.steamid64), id, Some(&reason)).await?;
    Ok(Json(RestoredRuns { runs }))
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct PreviewQuery {
    /// Any `SteamID` form.
    player: Option<String>,
    /// A server's ID.
    server: Option<i64>,
}

/// What a bulk invalidation would take, for staff to check before they confirm.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InvalidationPreview {
    /// The player, when asked about one.
    pub player: Option<PlayerRef>,
    /// The key's server, when asked about a key.
    pub server: Option<String>,
    /// Runs an invalidation would take.
    pub valid_runs: i64,
    /// Runs already invalidated.
    pub invalidated_runs: i64,
}

/// How many valid and invalidated runs a player or key has.
#[utoipa::path(
    get,
    path = "/v1/staff/invalidations/preview",
    tag = "staff",
    params(PreviewQuery),
    responses(
        (status = OK, body = InvalidationPreview),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs invalidate_runs", body = ErrorBody),
        (status = NOT_FOUND, description = "SourceJump has no such player or key", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Neither or both of player and key, or not a SteamID", body = ErrorBody),
    ),
)]
pub async fn get_invalidation_preview(
    State(state): State<AppState>,
    staff: Staff,
    Query(query): Query<PreviewQuery>,
) -> Result<Json<InvalidationPreview>, ApiError> {
    staff.require(Privilege::InvalidateRuns)?;
    let preview = match runs_of(query.player.as_deref(), query.server)? {
        RunsOf::Player(player) => {
            let row = sqlx::query!(
                r#"
                SELECT p.steamid64::text AS "steamid64!", p.name, p.avatar_url, p.country_code,
                       count(r.id) FILTER (WHERE r.invalidated_at IS NULL) AS "valid!",
                       count(r.id) FILTER (WHERE r.invalidated_at IS NOT NULL) AS "invalidated!"
                FROM players p LEFT JOIN runs r ON r.player_steamid64 = p.steamid64
                WHERE p.steamid64 = $1
                GROUP BY p.steamid64
                "#,
                player.get()
            )
            .fetch_optional(&state.db)
            .await?
            .ok_or(ApiError::NotFound("SourceJump has no such player"))?;
            InvalidationPreview {
                player: Some(PlayerRef {
                    steamid64: row.steamid64,
                    name: row.name,
                    avatar_url: row.avatar_url,
                    country_code: row.country_code,
                }),
                server: None,
                valid_runs: row.valid,
                invalidated_runs: row.invalidated,
            }
        }
        RunsOf::Server(server_id) => {
            let row = sqlx::query!(
                r#"
                SELECT s.name,
                       count(r.id) FILTER (WHERE r.invalidated_at IS NULL) AS "valid!",
                       count(r.id) FILTER (WHERE r.invalidated_at IS NOT NULL) AS "invalidated!"
                FROM servers s
                LEFT JOIN server_keys k ON k.server_id = s.id
                LEFT JOIN runs r ON r.key_id = k.id
                WHERE s.id = $1
                GROUP BY s.id
                "#,
                server_id
            )
            .fetch_optional(&state.db)
            .await?
            .ok_or(ApiError::NotFound("SourceJump has no such server"))?;
            InvalidationPreview {
                player: None,
                server: Some(row.name),
                valid_runs: row.valid,
                invalidated_runs: row.invalidated,
            }
        }
    };
    Ok(Json(preview))
}

/// A run as it was when it was invalidated.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InvalidatedRun {
    pub id: i64,
    pub map: String,
    pub style: String,
    pub track: i16,
    pub time: f64,
    /// Whether it's still invalidated.
    pub invalidated: bool,
}

/// One invalidation: of a run, of a player's, server's or key's runs, or of the runs a player sent while banned.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InvalidationEntry {
    /// Its staff log entry.
    pub id: i64,
    /// `invalidate_run`, `invalidate_player_runs`, `invalidate_server_runs`, `invalidate_key_runs` (made before
    /// a server's runs were invalidated together), or `ban_player` for the runs sent during a ban.
    pub action: StaffAction,
    /// Who did it; null for the server's command line.
    pub actor: Option<PlayerRef>,
    /// Whose runs: the player, or the run's player.
    pub player: Option<PlayerRef>,
    /// For a key's runs: the key's prefix.
    pub key: Option<String>,
    /// For a server's or key's runs: the server's name then.
    pub server: Option<String>,
    /// For one run.
    pub run: Option<InvalidatedRun>,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    /// How many runs it took. For a ban, how many are still invalid in its name.
    pub runs: i64,
    /// How many of those are still invalidated by it. A run restored on its own, or by restoring this, isn't.
    pub still_invalid: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Invalidations {
    pub invalidations: Vec<InvalidationEntry>,
    /// Pass as `cursor` for older ones; null when there are none.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct InvalidationsQuery {
    /// From a previous page's `next_cursor`.
    cursor: Option<String>,
    /// Only this player's (any `SteamID` form): their runs' invalidations, one or all, and their bans'.
    player: Option<String>,
    /// Only this server's (its ID): its runs' invalidations, with any of its keys.
    server: Option<i64>,
}

/// Every invalidation, newest first, 50 a page, or one player's or server's. A ban is listed while runs sent
/// during it are invalid.
#[utoipa::path(
    get,
    path = "/v1/staff/invalidations",
    tag = "staff",
    params(InvalidationsQuery),
    responses(
        (status = OK, body = Invalidations),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs invalidate_runs", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a cursor from this list, or not a SteamID", body = ErrorBody),
    ),
)]
pub async fn list_invalidations(
    State(state): State<AppState>,
    staff: Staff,
    Query(query): Query<InvalidationsQuery>,
) -> Result<Json<Invalidations>, ApiError> {
    staff.require(Privilege::InvalidateRuns)?;
    let before = match query.cursor {
        Some(cursor) => cursor
            .parse::<i64>()
            .map_err(|_| ApiError::Invalid("that isn't an invalidations cursor".to_owned()))?,
        None => i64::MAX,
    };
    let player = query.player.as_deref().map(parse_player).transpose()?;
    let actions = [
        StaffAction::InvalidateRun,
        StaffAction::InvalidatePlayerRuns,
        StaffAction::InvalidateServerRuns,
        StaffAction::InvalidateKeyRuns,
        StaffAction::BanPlayer,
    ]
    .map(|action| action.name().to_owned());
    // The run of a one-run invalidation is joined by ID for whether it's still invalid; the rest comes from
    // the log entry, as it was then.
    let rows = sqlx::query_as!(
        InvalidationRow,
        r#"
        SELECT l.id, l.action, l.target, l.reason, l.detail, l.at,
               a.steamid64::text AS "actor_steamid64?", a.name AS "actor_name?",
               a.avatar_url AS actor_avatar_url, a.country_code AS actor_country_code,
               p.steamid64::text AS "player_steamid64?", p.name AS "player_name?",
               p.avatar_url AS player_avatar_url, p.country_code AS player_country_code,
               (SELECT count(*) FROM runs WHERE invalidated_by = l.id) AS "still_invalid!"
        FROM staff_log l
        LEFT JOIN players a ON a.steamid64 = l.actor_steamid64
        LEFT JOIN players p ON p.steamid64 = (CASE l.action
            WHEN 'invalidate_run' THEN l.detail->>'player'
            WHEN 'invalidate_player_runs' THEN l.target
            WHEN 'ban_player' THEN l.target
        END)::bigint
        WHERE l.action = ANY($3) AND l.id < $1
          AND (l.action <> 'ban_player' OR EXISTS (SELECT 1 FROM runs WHERE invalidated_by = l.id))
          AND ($4::bigint IS NULL
               OR (l.action IN ('invalidate_player_runs', 'ban_player') AND l.target = $4::bigint::text)
               OR (l.action = 'invalidate_run' AND l.detail->>'player' = $4::bigint::text))
          AND ($5::bigint IS NULL
               OR (l.action IN ('invalidate_server_runs', 'invalidate_key_runs')
                   AND (l.detail->>'server_id')::bigint = $5))
        ORDER BY l.id DESC
        LIMIT $2
        "#,
        before,
        PAGE_SIZE + 1,
        &actions[..],
        player.map(SteamId64::get),
        query.server
    )
    .fetch_all(&state.db)
    .await?;

    let mut invalidations = rows
        .into_iter()
        .map(InvalidationRow::into_entry)
        .collect::<Result<Vec<_>, ApiError>>()?;
    let next_cursor = if invalidations.len() > usize::try_from(PAGE_SIZE).expect("small") {
        invalidations.pop();
        invalidations.last().map(|entry| entry.id.to_string())
    } else {
        None
    };
    Ok(Json(Invalidations {
        invalidations,
        next_cursor,
    }))
}

/// An invalidation's log entry as read, with its actor and player from LEFT JOINs.
struct InvalidationRow {
    id: i64,
    action: String,
    target: String,
    reason: Option<String>,
    detail: Value,
    at: DateTime<Utc>,
    actor_steamid64: Option<String>,
    actor_name: Option<String>,
    actor_avatar_url: Option<String>,
    actor_country_code: Option<String>,
    player_steamid64: Option<String>,
    player_name: Option<String>,
    player_avatar_url: Option<String>,
    player_country_code: Option<String>,
    still_invalid: i64,
}

impl InvalidationRow {
    fn into_entry(self) -> Result<InvalidationEntry, ApiError> {
        let action = StaffAction::from_name(&self.action).ok_or_else(|| {
            ApiError::Internal(format!("unknown staff action {:?}", self.action).into())
        })?;
        let one_run = action == StaffAction::InvalidateRun;
        let run = if one_run {
            Some(logged_run(
                &self.target,
                &self.detail,
                self.still_invalid > 0,
            )?)
        } else {
            None
        };
        let is_key = action == StaffAction::InvalidateKeyRuns;
        let of_server = is_key || action == StaffAction::InvalidateServerRuns;
        Ok(InvalidationEntry {
            id: self.id,
            action,
            actor: player_ref(
                self.actor_steamid64,
                self.actor_name,
                self.actor_avatar_url,
                self.actor_country_code,
            ),
            player: player_ref(
                self.player_steamid64,
                self.player_name,
                self.player_avatar_url,
                self.player_country_code,
            ),
            key: is_key.then(|| self.target.clone()),
            server: of_server.then(|| text(&self.detail, "server")),
            runs: match action {
                StaffAction::InvalidateRun => 1,
                StaffAction::BanPlayer => self.still_invalid,
                _ => self.detail["runs"].as_i64().unwrap_or_default(),
            },
            run,
            reason: self.reason,
            at: self.at,
            still_invalid: self.still_invalid,
        })
    }
}

/// The run a one-run invalidation's log entry describes.
fn logged_run(target: &str, detail: &Value, invalidated: bool) -> Result<InvalidatedRun, ApiError> {
    Ok(InvalidatedRun {
        id: target
            .parse()
            .map_err(|_| ApiError::Internal(format!("run ID {target:?} in the log").into()))?,
        map: text(detail, "map"),
        style: text(detail, "style"),
        track: detail["track"]
            .as_i64()
            .and_then(|t| i16::try_from(t).ok())
            .unwrap_or_default(),
        time: detail["time"].as_f64().unwrap_or_default(),
        invalidated,
    })
}

fn text(detail: &Value, field: &str) -> String {
    detail[field].as_str().unwrap_or_default().to_owned()
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::*;
    use crate::{
        auth::sessions,
        players::privileges::{self, Privileges},
        runs::{
            RunAccepted,
            tests::{run, setup},
        },
        servers::keys,
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287920";
    const GABE: &str = "76561197960287930";
    const ZED: &str = "76561197960287931";

    async fn session(db: &PgPool, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(STAFF).unwrap();
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

    /// Submits a run by `player` finishing `at` seconds after the helper's time, and returns its ID.
    async fn submit(db: &PgPool, key: &str, id: &str, player: &str, time: f64, at: i64) -> i64 {
        let mut body = run(id, time);
        body["player"] = json!({ "steamid64": player, "name": format!("p{}", &player[15..]) });
        body["finished_at"] = json!(1_792_400_000 + at);
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(key), &body)
            .await
            .json();
        accepted.id
    }

    /// The map's normal leaderboard, as (player, time).
    async fn board(db: &PgPool) -> Vec<(String, f64)> {
        let board: Value = test_client::get(db, "/v1/maps/bhop_badges/leaderboard?style=normal")
            .await
            .json();
        board["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                let player = e["player"]["steamid64"].as_str().unwrap().to_owned();
                (player, e["time"].as_f64().unwrap())
            })
            .collect()
    }

    /// The times in the map's normal WR history, oldest first.
    async fn records(db: &PgPool) -> Vec<f64> {
        let history: Value = test_client::get(db, "/v1/maps/bhop_badges/wr-history?style=normal")
            .await
            .json();
        history["records"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["time"].as_f64().unwrap())
            .collect()
    }

    async fn detail(db: &PgPool, id: i64) -> Value {
        test_client::get(db, &format!("/v1/runs/{id}")).await.json()
    }

    fn reason(text: &str) -> Value {
        json!({ "reason": text })
    }

    #[sqlx::test]
    async fn invalidating_a_record_promotes_the_next_run(db: PgPool) {
        let key = setup(&db).await;
        let token = session(&db, &[Privilege::InvalidateRuns]).await;
        let zed_slow = submit(&db, &key, "z1", ZED, 35.0, 0).await;
        let gabe_slow = submit(&db, &key, "g1", GABE, 32.0, 10).await;
        let record = submit(&db, &key, "g2", GABE, 30.0, 20).await;
        assert_eq!(records(&db).await, [35.0, 32.0, 30.0]);

        let path = format!("/v1/staff/runs/{record}/invalidate");
        let done = send(&db, "POST", &path, &token, Some(reason("Wrong zones"))).await;
        assert_eq!(done.status, 204);

        // gabe's slower run is his personal best again and holds the record, on the board and in history.
        assert_eq!(
            board(&db).await,
            [(GABE.to_owned(), 32.0), (ZED.to_owned(), 35.0)]
        );
        assert_eq!(records(&db).await, [35.0, 32.0]);
        let gone = detail(&db, record).await;
        assert_eq!(
            (&gone["invalidated"], &gone["personal_best"], &gone["rank"]),
            (&json!(true), &json!(false), &Value::Null)
        );
        assert_eq!(gone["world_record_time"], 32.0);
        crate::leaderboards::world_records::tests::assert_current(&db).await;
        let promoted = detail(&db, gabe_slow).await;
        assert_eq!(
            (&promoted["personal_best"], &promoted["rank"]),
            (&json!(true), &json!(1))
        );

        // Invalidating a player's last run on a board leaves them off it.
        let path = format!("/v1/staff/runs/{zed_slow}/invalidate");
        send(&db, "POST", &path, &token, Some(reason("Bug"))).await;
        assert_eq!(board(&db).await, [(GABE.to_owned(), 32.0)]);
        assert_eq!(
            send(&db, "POST", &path, &token, Some(reason("Twice")))
                .await
                .status,
            422
        );

        let path = format!("/v1/staff/runs/{record}/restore");
        assert_eq!(
            send(&db, "POST", &path, &token, Some(reason("Zones were fine")))
                .await
                .status,
            204
        );
        assert_eq!(board(&db).await, [(GABE.to_owned(), 30.0)]);
        assert_eq!(records(&db).await, [32.0, 30.0]);
        crate::leaderboards::world_records::tests::assert_current(&db).await;
        assert_eq!(
            send(&db, "POST", &path, &token, Some(reason("Twice")))
                .await
                .status,
            422
        );

        let logged =
            sqlx::query!("SELECT action, target, reason, detail FROM staff_log ORDER BY id")
                .fetch_all(&db)
                .await
                .unwrap();
        let actions: Vec<_> = logged.iter().map(|row| row.action.as_str()).collect();
        assert_eq!(actions, ["invalidate_run", "invalidate_run", "restore_run"]);
        assert_eq!(logged[0].target, record.to_string());
        assert_eq!(logged[0].reason.as_deref(), Some("Wrong zones"));
        assert_eq!(logged[0].detail["player"], GABE);
        assert_eq!(logged[0].detail["time"], 30.0);
    }

    #[sqlx::test]
    async fn staff_cant_invalidate_or_restore_their_own_runs(db: PgPool) {
        let key = setup(&db).await;
        let token = session(&db, &[Privilege::InvalidateRuns]).await;
        let colleague = SteamId64::parse_any("76561197960287921").unwrap();
        privileges::grant(&db, colleague, Privileges::of(&[Privilege::InvalidateRuns]))
            .await
            .unwrap();
        let colleague_token = sessions::create(&db, colleague).await.unwrap();
        let own = submit(&db, &key, "s1", STAFF, 30.0, 0).await;
        submit(&db, &key, "g1", GABE, 31.0, 10).await;

        let invalidate = format!("/v1/staff/runs/{own}/invalidate");
        let refused = send(&db, "POST", &invalidate, &token, Some(reason("Mine"))).await;
        assert_eq!(refused.status, 422);
        let body = json!({ "player": STAFF, "reason": "Mine" });
        let refused = send(&db, "POST", "/v1/staff/invalidations", &token, Some(body)).await;
        assert_eq!(refused.status, 422);
        assert_eq!(board(&db).await.len(), 2);

        // A server-wide invalidation takes the staff member's run too. Restoring it brings back everyone
        // else's; their own waits for a colleague, who restores the same invalidation.
        let server_id: i64 = sqlx::query_scalar("SELECT id FROM servers")
            .fetch_one(&db)
            .await
            .unwrap();
        let body = json!({ "server": server_id, "reason": "Bad server" });
        let bulk: InvalidatedRuns =
            send(&db, "POST", "/v1/staff/invalidations", &token, Some(body))
                .await
                .json();
        assert_eq!(bulk.runs, 2);
        let restore = format!("/v1/staff/invalidations/{}/restore", bulk.id);
        let restored: RestoredRuns = send(&db, "POST", &restore, &token, Some(reason("Fine")))
            .await
            .json();
        assert_eq!(restored.runs, 1);
        assert_eq!(board(&db).await, [(GABE.to_owned(), 31.0)]);
        let refused = send(&db, "POST", &restore, &token, Some(reason("Fine"))).await;
        assert_eq!(refused.status, 422);
        let restore_own = format!("/v1/staff/runs/{own}/restore");
        let refused = send(&db, "POST", &restore_own, &token, Some(reason("Fine"))).await;
        assert_eq!(refused.status, 422);

        let restored: RestoredRuns = send(
            &db,
            "POST",
            &restore,
            &colleague_token,
            Some(reason("Fine")),
        )
        .await
        .json();
        assert_eq!(restored.runs, 1);
        assert_eq!(board(&db).await.len(), 2);
    }

    #[sqlx::test]
    async fn restoring_a_players_invalidation_brings_back_only_what_it_took(db: PgPool) {
        let key = setup(&db).await;
        let token = session(&db, &[Privilege::InvalidateRuns]).await;
        let earlier = submit(&db, &key, "g1", GABE, 33.0, 0).await;
        let kept_out = submit(&db, &key, "g2", GABE, 31.0, 10).await;
        let restored_alone = submit(&db, &key, "g3", GABE, 32.0, 20).await;
        submit(&db, &key, "z1", ZED, 35.0, 30).await;

        let path = format!("/v1/staff/runs/{kept_out}/invalidate");
        send(&db, "POST", &path, &token, Some(reason("Separate"))).await;

        let preview: InvalidationPreview = send(
            &db,
            "GET",
            &format!("/v1/staff/invalidations/preview?player={GABE}"),
            &token,
            None,
        )
        .await
        .json();
        assert_eq!(preview.player.unwrap().steamid64, GABE);
        assert_eq!((preview.valid_runs, preview.invalidated_runs), (2, 1));

        let body = json!({ "player": GABE, "reason": "Alt account" });
        let created = send(&db, "POST", "/v1/staff/invalidations", &token, Some(body)).await;
        assert_eq!(created.status, 201);
        let bulk: InvalidatedRuns = created.json();
        assert_eq!(bulk.runs, 2);
        assert_eq!(board(&db).await, [(ZED.to_owned(), 35.0)]);

        let path = format!("/v1/staff/runs/{restored_alone}/restore");
        send(
            &db,
            "POST",
            &path,
            &token,
            Some(reason("This one was fine")),
        )
        .await;

        let list: Invalidations = send(&db, "GET", "/v1/staff/invalidations", &token, None)
            .await
            .json();
        let summary: Vec<_> = list
            .invalidations
            .iter()
            .map(|i| (i.action, i.runs, i.still_invalid))
            .collect();
        assert_eq!(
            summary,
            [
                (StaffAction::InvalidatePlayerRuns, 2, 1),
                (StaffAction::InvalidateRun, 1, 1)
            ]
        );
        assert_eq!(
            list.invalidations[0].player.as_ref().unwrap().steamid64,
            GABE
        );
        assert_eq!(list.invalidations[1].run.as_ref().unwrap().time, 31.0);

        let path = format!("/v1/staff/invalidations/{}/restore", bulk.id);
        let restored: RestoredRuns = send(&db, "POST", &path, &token, Some(reason("Not an alt")))
            .await
            .json();
        assert_eq!(restored.runs, 1);
        // The run invalidated on its own stays out; gabe's best valid run is back.
        assert_eq!(detail(&db, kept_out).await["invalidated"], true);
        assert_eq!(detail(&db, earlier).await["invalidated"], false);
        assert_eq!(
            board(&db).await,
            [(GABE.to_owned(), 32.0), (ZED.to_owned(), 35.0)]
        );
        assert_eq!(
            send(&db, "POST", &path, &token, Some(reason("Again")))
                .await
                .status,
            422
        );
        crate::leaderboards::world_records::tests::assert_current(&db).await;
        // A one-run invalidation is restored on the run, not here.
        let one_run = list.invalidations[1].id;
        let path = format!("/v1/staff/invalidations/{one_run}/restore");
        assert_eq!(
            send(&db, "POST", &path, &token, Some(reason("Wrong way")))
                .await
                .status,
            404
        );
    }

    #[sqlx::test]
    async fn revoking_a_key_can_invalidate_every_run_its_server_sent(db: PgPool) {
        let key = setup(&db).await;
        let other = keys::issue(&db, "Other server").await.unwrap();
        crate::runs::tests::backdate(&db).await;
        submit(&db, &key, "g1", GABE, 30.0, 0).await;
        submit(&db, &other.key, "z1", ZED, 35.0, 0).await;
        // A run sent with the server's earlier key goes too.
        let server_id: i64 =
            sqlx::query_scalar("SELECT server_id FROM server_keys ORDER BY id LIMIT 1")
                .fetch_one(&db)
                .await
                .unwrap();
        let mut conn = db.acquire().await.unwrap();
        let current = keys::replace(&mut conn, server_id).await.unwrap().unwrap();
        drop(conn);
        submit(&db, &current.issued.key, "z2", ZED, 33.0, 10).await;
        let path = format!("/v1/staff/keys/{}/revoke", current.issued.prefix);
        let body = json!({ "reason": "Cheating server", "invalidate_runs": true });

        let keys_only = session(&db, &[Privilege::ManageKeys]).await;
        let refused = send(&db, "POST", &path, &keys_only, Some(body.clone())).await;
        assert_eq!(refused.status, 403);
        assert_eq!(board(&db).await.len(), 2);

        let token = session(&db, &[Privilege::ManageKeys, Privilege::InvalidateRuns]).await;
        assert_eq!(
            send(&db, "POST", &path, &token, Some(body)).await.status,
            204
        );
        assert_eq!(board(&db).await, [(ZED.to_owned(), 35.0)]);
        crate::leaderboards::world_records::tests::assert_current(&db).await;
        let logged =
            sqlx::query!("SELECT action, target, reason, detail FROM staff_log ORDER BY id")
                .fetch_all(&db)
                .await
                .unwrap();
        let actions: Vec<_> = logged.iter().map(|row| row.action.as_str()).collect();
        assert_eq!(actions, ["revoke_key", "invalidate_server_runs"]);
        assert_eq!(logged[1].target, server_id.to_string());
        assert_eq!(logged[1].reason.as_deref(), Some("Cheating server"));
        assert_eq!(
            (
                logged[1].detail["runs"].clone(),
                logged[1].detail["server"].clone()
            ),
            (json!(2), json!("Test server"))
        );

        // Restoring it brings both back and names the server.
        let id =
            sqlx::query_scalar!("SELECT id FROM staff_log WHERE action = 'invalidate_server_runs'")
                .fetch_one(&db)
                .await
                .unwrap();
        let restore = format!("/v1/staff/invalidations/{id}/restore");
        let restored = send(&db, "POST", &restore, &token, Some(reason("Wrong server"))).await;
        assert_eq!(restored.json::<RestoredRuns>().runs, 2);
        crate::leaderboards::world_records::tests::assert_current(&db).await;
        let detail =
            sqlx::query_scalar!("SELECT detail FROM staff_log WHERE action = 'restore_runs'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(detail["server"], "Test server");
    }

    #[sqlx::test]
    async fn bulk_invalidation_needs_one_target_a_reason_and_runs(db: PgPool) {
        let key = setup(&db).await;
        let token = session(&db, &[Privilege::InvalidateRuns]).await;
        submit(&db, &key, "g1", GABE, 30.0, 0).await;
        for body in [
            json!({ "reason": "Neither" }),
            json!({ "player": GABE, "server": 1, "reason": "Both" }),
            json!({ "player": "nobody", "reason": "Not a SteamID" }),
            json!({ "player": GABE, "reason": " " }),
            json!({ "player": ZED, "reason": "No runs" }),
        ] {
            let response = send(&db, "POST", "/v1/staff/invalidations", &token, Some(body)).await;
            assert_eq!(response.status, 422);
        }
        let preview = format!("/v1/staff/invalidations/preview?player={ZED}");
        assert_eq!(send(&db, "GET", &preview, &token, None).await.status, 404);
        assert_eq!(
            send(
                &db,
                "POST",
                "/v1/staff/runs/999/invalidate",
                &token,
                Some(reason("Gone"))
            )
            .await
            .status,
            404
        );
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM staff_log")
                .fetch_one(&db)
                .await
                .unwrap(),
            Some(0)
        );
    }

    #[sqlx::test]
    async fn a_runs_log_holds_its_own_entries_and_what_holds_it_out(db: PgPool) {
        let key = setup(&db).await;
        let token = session(&db, &[Privilege::InvalidateRuns]).await;
        let run = submit(&db, &key, "g1", GABE, 31.0, 0).await;
        let other = submit(&db, &key, "g2", GABE, 32.0, 10).await;
        let entries = |db: PgPool, token: String| async move {
            let log: log::LogEntries = send(
                &db,
                "GET",
                &format!("/v1/staff/runs/{run}/log"),
                &token,
                None,
            )
            .await
            .json();
            log.entries
                .into_iter()
                .map(|e| (e.action, e.reason.unwrap_or_default()))
                .collect::<Vec<_>>()
        };
        assert_eq!(entries(db.clone(), token.clone()).await, []);

        for (action, why) in [("invalidate", "Speed"), ("restore", "Demo was fine")] {
            let path = format!("/v1/staff/runs/{run}/{action}");
            send(&db, "POST", &path, &token, Some(reason(why))).await;
        }
        // Another run's entry isn't this run's.
        let path = format!("/v1/staff/runs/{other}/invalidate");
        send(&db, "POST", &path, &token, Some(reason("Other"))).await;
        let body = json!({ "player": GABE, "reason": "Alt account" });
        let bulk: InvalidatedRuns =
            send(&db, "POST", "/v1/staff/invalidations", &token, Some(body))
                .await
                .json();
        assert_eq!(
            entries(db.clone(), token.clone()).await,
            [
                (StaffAction::InvalidatePlayerRuns, "Alt account".to_owned()),
                (StaffAction::RestoreRun, "Demo was fine".to_owned()),
                (StaffAction::InvalidateRun, "Speed".to_owned()),
            ]
        );

        // Restored, the bulk action no longer holds the run, so only the run's own entries stay.
        let path = format!("/v1/staff/invalidations/{}/restore", bulk.id);
        send(&db, "POST", &path, &token, Some(reason("Not an alt"))).await;
        assert_eq!(entries(db.clone(), token.clone()).await.len(), 2);

        let missing = send(&db, "GET", "/v1/staff/runs/999999/log", &token, None).await;
        assert_eq!(missing.status, 404);
    }

    #[sqlx::test]
    async fn players_who_arent_staff_cant_read_a_runs_log(db: PgPool) {
        let key = setup(&db).await;
        let run = submit(&db, &key, "g1", GABE, 31.0, 0).await;
        let token = session(&db, &[Privilege::PostCommunity]).await;
        let path = format!("/v1/staff/runs/{run}/log");
        assert_eq!(send(&db, "GET", &path, &token, None).await.status, 403);
    }

    #[sqlx::test]
    async fn every_route_needs_invalidate_runs(db: PgPool) {
        let key = setup(&db).await;
        let id = submit(&db, &key, "g1", GABE, 30.0, 0).await;
        // Every other staff privilege, but not this one.
        let others: Vec<Privilege> = Privilege::ALL
            .into_iter()
            .filter(|&p| p.is_staff() && p != Privilege::InvalidateRuns)
            .collect();
        let token = session(&db, &others).await;
        let bulk = json!({ "player": GABE, "reason": "Because" });
        for (method, path, body) in [
            (
                "POST",
                format!("/v1/staff/runs/{id}/invalidate"),
                Some(reason("Because")),
            ),
            (
                "POST",
                format!("/v1/staff/runs/{id}/restore"),
                Some(reason("Because")),
            ),
            ("GET", "/v1/staff/invalidations".to_owned(), None),
            ("POST", "/v1/staff/invalidations".to_owned(), Some(bulk)),
            (
                "GET",
                format!("/v1/staff/invalidations/preview?player={GABE}"),
                None,
            ),
            (
                "POST",
                "/v1/staff/invalidations/1/restore".to_owned(),
                Some(reason("Because")),
            ),
        ] {
            let response = send(&db, method, &path, &token, body).await;
            assert_eq!(response.status, 403, "{method} {path}");
        }
        assert_eq!(detail(&db, id).await["invalidated"], false);
    }
}
