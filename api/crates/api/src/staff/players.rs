//! Staff tools for players: one player's staff page (their bans, runs and privileges) and banning and lifting
//! bans (`manage_bans`). Changing privileges is in `staff/privileges.rs`.
//!
//! Sensitive path, fails closed. A ban, its staff log entry and, when staff ask, the invalidation of the
//! player's existing runs are one transaction. Nobody bans themselves or lifts their own ban. Bans aren't
//! public, and neither are reasons (lead, 2026-10-20).

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use utoipa::ToSchema;

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction, check_reason},
    runs::{RunsOf, invalidate_runs_of},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{
        PlayerRef, SteamId64,
        privileges::{Privilege, Privileges},
        restrictions::{Restriction, Restrictions},
    },
};

/// Ended bans the bans list shows, newest first.
const RECENTLY_ENDED: i64 = 50;

/// What a ban did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Banned {
    pub id: i64,
    /// Existing runs it invalidated; 0 when staff chose not to.
    pub invalidated_runs: i64,
}

/// Bans a player and logs it, invalidating their valid runs too when asked (logged as its own action). A
/// player SourceJump hasn't seen is created, so a known cheater can be banned before their first run.
pub async fn ban(
    db: &PgPool,
    actor: Option<SteamId64>,
    player: SteamId64,
    restrictions: Restrictions,
    reason: &str,
    ends_at: Option<DateTime<Utc>>,
    invalidate_runs: bool,
) -> Result<Banned, ChangeError> {
    if restrictions.is_empty() {
        return Err(ChangeError::Invalid(
            "choose what the ban restricts".to_owned(),
        ));
    }
    if invalidate_runs && !restrictions.contains(Restriction::NoRecords) {
        return Err(ChangeError::Invalid(
            "only a ban from records can invalidate existing runs".to_owned(),
        ));
    }
    if ends_at.is_some_and(|end| end <= Utc::now()) {
        return Err(ChangeError::Invalid(
            "the end must be in the future".to_owned(),
        ));
    }
    if actor == Some(player) {
        return Err(ChangeError::Invalid("you can't ban yourself".to_owned()));
    }

    let mut tx = db.begin().await?;
    // Exclusive on the player's row, which the ingest locks shared: see `restrictions::records_ban`.
    sqlx::query!(
        "INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1::bigint, $1::bigint::text, '-infinity')
         ON CONFLICT (steamid64) DO NOTHING",
        player.get()
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "SELECT 1 AS locked FROM players WHERE steamid64 = $1 FOR UPDATE",
        player.get()
    )
    .fetch_one(&mut *tx)
    .await?;

    let names: Vec<Restriction> = restrictions.list();
    let entry = log::Entry {
        actor,
        action: StaffAction::BanPlayer,
        target: &player.to_string(),
        reason: Some(reason),
        detail: json!({ "restrictions": names, "ends_at": ends_at }),
    };
    let log_id = log::record(&mut tx, entry).await?;
    let id = sqlx::query_scalar!(
        "INSERT INTO bans (player_steamid64, restrictions, reason, banned_by, ends_at, log_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        player.get(),
        restrictions.bits(),
        reason,
        actor.map(SteamId64::get),
        ends_at,
        log_id
    )
    .fetch_one(&mut *tx)
    .await?;
    let runs_taken = if invalidate_runs {
        invalidate_runs_of(&mut tx, actor, RunsOf::Player(player), Some(reason))
            .await?
            .map_or(0, |done| done.runs)
    } else {
        0
    };
    if restrictions.contains(Restriction::NoRecords) {
        crate::leaderboards::standings::refresh_legacy(&mut tx).await?;
    }
    tx.commit().await?;
    Ok(Banned {
        id,
        invalidated_runs: runs_taken,
    })
}

/// Lifts an active ban and logs it. The runs it invalidated stay invalid; staff restore them from the runs
/// page if they should come back (lead, 2026-10-20).
pub async fn lift(
    db: &PgPool,
    actor: Option<SteamId64>,
    ban_id: i64,
    reason: &str,
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let ban = sqlx::query!(
        r#"SELECT player_steamid64, restrictions, lifted_at IS NOT NULL AS "lifted!",
                  ends_at IS NOT NULL AND ends_at <= now() AS "ended!"
           FROM bans WHERE id = $1 FOR UPDATE"#,
        ban_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound("there's no such ban"))?;
    if ban.lifted {
        return Err(ChangeError::Invalid(
            "this ban was lifted already".to_owned(),
        ));
    }
    if ban.ended {
        return Err(ChangeError::Invalid("this ban has ended".to_owned()));
    }
    if actor.map(SteamId64::get) == Some(ban.player_steamid64) {
        return Err(ChangeError::Invalid(
            "you can't lift your own ban".to_owned(),
        ));
    }
    let restrictions = Restrictions::from_bits(ban.restrictions).list();
    let entry = log::Entry {
        actor,
        action: StaffAction::LiftBan,
        target: &ban.player_steamid64.to_string(),
        reason: Some(reason),
        detail: json!({ "ban": ban_id, "restrictions": restrictions }),
    };
    log::record(&mut tx, entry).await?;
    sqlx::query!(
        "UPDATE bans SET lifted_at = now(), lifted_by = $2, lift_reason = $3 WHERE id = $1",
        ban_id,
        actor.map(SteamId64::get),
        reason
    )
    .execute(&mut *tx)
    .await?;
    crate::leaderboards::standings::refresh_legacy(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

/// A ban, as staff see it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Ban {
    pub id: i64,
    pub player: PlayerRef,
    pub restrictions: Vec<Restriction>,
    pub reason: String,
    /// Null for the server's command line.
    pub banned_by: Option<PlayerRef>,
    pub banned_at: DateTime<Utc>,
    /// Null: until lifted.
    pub ends_at: Option<DateTime<Utc>>,
    /// Whether it's in force now: not lifted, and its end hasn't passed.
    pub active: bool,
    pub lifted_at: Option<DateTime<Utc>>,
    pub lifted_by: Option<PlayerRef>,
    pub lift_reason: Option<String>,
}

/// Which bans to read.
enum Which {
    Player(SteamId64),
    Active,
    Ended,
}

async fn read_bans(db: &PgPool, which: Which) -> Result<Vec<Ban>, sqlx::Error> {
    let (player, active, limit) = match which {
        Which::Player(player) => (Some(player.get()), None, i64::MAX),
        Which::Active => (None, Some(true), i64::MAX),
        Which::Ended => (None, Some(false), RECENTLY_ENDED),
    };
    let rows = sqlx::query!(
        r#"
        SELECT * FROM (
            SELECT b.id, b.restrictions, b.reason, b.banned_at, b.ends_at, b.lifted_at, b.lift_reason,
                   EXISTS (SELECT 1 FROM active_bans a WHERE a.id = b.id) AS "active!",
                   p.steamid64::text AS "steamid64!", p.name, p.avatar_url, p.country_code,
                   s.steamid64::text AS "by_steamid64?", s.name AS "by_name?",
                   s.avatar_url AS by_avatar_url, s.country_code AS by_country_code,
                   l.steamid64::text AS "lifter_steamid64?", l.name AS "lifter_name?",
                   l.avatar_url AS lifter_avatar_url, l.country_code AS lifter_country_code
            FROM bans b
            JOIN players p ON p.steamid64 = b.player_steamid64
            LEFT JOIN players s ON s.steamid64 = b.banned_by
            LEFT JOIN players l ON l.steamid64 = b.lifted_by
            WHERE $1::bigint IS NULL OR b.player_steamid64 = $1
        ) bans
        WHERE $2::bool IS NULL OR "active!" = $2
        -- Active bans newest first; ended ones by when they ended.
        ORDER BY CASE WHEN "active!" THEN banned_at ELSE coalesce(lifted_at, ends_at) END DESC, id DESC
        LIMIT $3
        "#,
        player,
        active,
        limit
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Ban {
            id: row.id,
            player: PlayerRef {
                steamid64: row.steamid64,
                name: row.name,
                avatar_url: row.avatar_url,
                country_code: row.country_code,
            },
            restrictions: Restrictions::from_bits(row.restrictions).list(),
            reason: row.reason,
            banned_by: log::player_ref(
                row.by_steamid64,
                row.by_name,
                row.by_avatar_url,
                row.by_country_code,
            ),
            banned_at: row.banned_at,
            ends_at: row.ends_at,
            active: row.active,
            lifted_at: row.lifted_at,
            lifted_by: log::player_ref(
                row.lifter_steamid64,
                row.lifter_name,
                row.lifter_avatar_url,
                row.lifter_country_code,
            ),
            lift_reason: row.lift_reason,
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Bans {
    /// Every ban in force, newest first.
    pub active: Vec<Ban>,
    /// The 50 most recently ended or lifted.
    pub ended: Vec<Ban>,
}

/// Bans in force and recently ended ones.
#[utoipa::path(
    get,
    path = "/v1/staff/bans",
    tag = "staff",
    responses(
        (status = OK, body = Bans),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_bans", body = ErrorBody),
    ),
)]
pub async fn list_bans(
    State(state): State<AppState>,
    staff: Staff,
) -> Result<Json<Bans>, ApiError> {
    staff.require(Privilege::ManageBans)?;
    Ok(Json(Bans {
        active: read_bans(&state.db, Which::Active).await?,
        ended: read_bans(&state.db, Which::Ended).await?,
    }))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffPlayer {
    pub player: PlayerRef,
    /// Whether SourceJump has seen them sign in or play. A player who hasn't is shown by `SteamID`.
    pub seen: bool,
    pub valid_runs: i64,
    pub invalidated_runs: i64,
    /// Every ban, newest first. Present for staff with `manage_bans`.
    pub bans: Option<Vec<Ban>>,
    /// What they hold. Present for staff with `manage_privileges`.
    pub privileges: Option<Vec<Privilege>>,
}

/// One player as staff see them. Any `SteamID` answers, so staff can act on a player before their first run.
#[utoipa::path(
    get,
    path = "/v1/staff/players/{player}",
    tag = "staff",
    params(("player" = String, Path, description = "SteamID64, SteamID2 or SteamID3")),
    responses(
        (status = OK, body = StaffPlayer),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_bans, invalidate_runs, manage_privileges or review_anticheat", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID", body = ErrorBody),
    ),
)]
pub async fn get_staff_player(
    State(state): State<AppState>,
    staff: Staff,
    Path(player): Path<String>,
) -> Result<Json<StaffPlayer>, ApiError> {
    staff.require_any(&[
        Privilege::ManageBans,
        Privilege::InvalidateRuns,
        Privilege::ManagePrivileges,
        Privilege::ReviewAnticheat,
    ])?;
    let steamid64 = parse_player(&player)?;
    let row = sqlx::query!(
        r#"
        SELECT p.name, p.avatar_url, p.country_code, p.privileges, p.name_seen_at > '-infinity' AS "seen!",
               (SELECT count(*) FROM runs WHERE player_steamid64 = p.steamid64 AND invalidated_at IS NULL) AS "valid!",
               (SELECT count(*) FROM runs WHERE player_steamid64 = p.steamid64 AND invalidated_at IS NOT NULL) AS "invalidated!"
        FROM players p WHERE p.steamid64 = $1
        "#,
        steamid64.get()
    )
    .fetch_optional(&state.db)
    .await?;
    let bans = if staff.privileges.contains(Privilege::ManageBans) {
        Some(read_bans(&state.db, Which::Player(steamid64)).await?)
    } else {
        None
    };
    let held = |bits: i64| {
        staff
            .privileges
            .contains(Privilege::ManagePrivileges)
            .then(|| Privileges::from_bits(bits).list())
    };
    let id = steamid64.to_string();
    let answer = match row {
        Some(row) => StaffPlayer {
            player: PlayerRef {
                steamid64: id,
                name: row.name,
                avatar_url: row.avatar_url,
                country_code: row.country_code,
            },
            seen: row.seen,
            valid_runs: row.valid,
            invalidated_runs: row.invalidated,
            bans,
            privileges: held(row.privileges),
        },
        None => StaffPlayer {
            player: PlayerRef {
                name: id.clone(),
                steamid64: id,
                avatar_url: None,
                country_code: None,
            },
            seen: false,
            valid_runs: 0,
            invalidated_runs: 0,
            bans,
            privileges: held(0),
        },
    };
    Ok(Json(answer))
}

pub(super) fn parse_player(player: &str) -> Result<SteamId64, ApiError> {
    SteamId64::parse_any(player.trim())
        .ok_or_else(|| ApiError::Invalid(format!("{player:?} is not a SteamID")))
}

/// The staff log's entries about one player, newest first, up to 100: actions on them, their runs and their
/// posts. Any staff member may read it, as the whole log.
#[utoipa::path(
    get,
    path = "/v1/staff/players/{player}/log",
    tag = "staff",
    params(("player" = String, Path, description = "SteamID64, SteamID2 or SteamID3"), log::EntriesQuery),
    responses(
        (status = OK, body = log::LogEntries),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not staff", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID", body = ErrorBody),
    ),
)]
pub async fn get_player_log(
    State(state): State<AppState>,
    _staff: Staff,
    Path(player): Path<String>,
    Query(query): Query<log::EntriesQuery>,
) -> Result<Json<log::LogEntries>, ApiError> {
    let player = parse_player(&player)?;
    Ok(Json(
        log::player_entries(&state.db, player, query.before()?).await?,
    ))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BanRequest {
    /// At least one.
    pub restrictions: Vec<Restriction>,
    /// Why, for staff only. 1 to 500 characters.
    pub reason: String,
    /// When it ends by itself; null or left out: until lifted.
    pub ends_at: Option<DateTime<Utc>>,
    /// Also invalidate every valid run they have. Needs `no_records`, and the `invalidate_runs` privilege.
    #[serde(default)]
    pub invalidate_runs: bool,
}

/// Ban a player. While banned from records, their new runs are stored invalid and no replay is asked for.
#[utoipa::path(
    post,
    path = "/v1/staff/players/{player}/bans",
    tag = "staff",
    params(("player" = String, Path, description = "SteamID64, SteamID2 or SteamID3")),
    request_body = BanRequest,
    responses(
        (status = CREATED, body = Banned),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_bans (and invalidate_runs to invalidate), from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID, no restriction or reason, an end in the past, or yourself", body = ErrorBody),
    ),
)]
pub async fn post_ban(
    State(state): State<AppState>,
    staff: Staff,
    Path(player): Path<String>,
    JsonBody(request): JsonBody<BanRequest>,
) -> Result<(StatusCode, Json<Banned>), ApiError> {
    staff.require(Privilege::ManageBans)?;
    if request.invalidate_runs {
        staff.require(Privilege::InvalidateRuns)?;
    }
    let player = parse_player(&player)?;
    let reason = check_reason(&request.reason)?;
    let banned = ban(
        &state.db,
        Some(staff.steamid64),
        player,
        Restrictions::of(&request.restrictions),
        &reason,
        request.ends_at,
        request.invalidate_runs,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(banned)))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LiftBanRequest {
    /// Why, for staff only. 1 to 500 characters.
    pub reason: String,
}

/// Lift a ban before its end. The runs it invalidated stay invalid until restored on the runs page.
#[utoipa::path(
    post,
    path = "/v1/staff/bans/{id}/lift",
    tag = "staff",
    params(("id" = i64, Path, description = "The ban's ID")),
    request_body = LiftBanRequest,
    responses(
        (status = NO_CONTENT, description = "Lifted"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_bans, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such ban", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Already lifted or ended, your own, or no reason", body = ErrorBody),
    ),
)]
pub async fn post_lift_ban(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    JsonBody(request): JsonBody<LiftBanRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageBans)?;
    let reason = check_reason(&request.reason)?;
    lift(&state.db, Some(staff.steamid64), id, &reason).await?;
    Ok(StatusCode::NO_CONTENT)
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
        runs::tests::{run, setup},
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287920";
    const GABE: &str = "76561197960287930";

    async fn session(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
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

    /// gabe submits a run; returns the answer.
    async fn submit(db: &PgPool, key: &str, id: &str, time: f64) -> Value {
        let response = test_client::post(db, "/v1/runs", Some(key), &run(id, time)).await;
        assert_eq!(response.status, 201);
        response.json()
    }

    async fn board(db: &PgPool) -> Vec<f64> {
        let board: Value = test_client::get(db, "/v1/maps/bhop_badges/leaderboard?style=normal")
            .await
            .json();
        board["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["time"].as_f64().unwrap())
            .collect()
    }

    /// Bans gabe with `body`.
    async fn post_ban(db: &PgPool, token: &str, body: Value) -> TestResponse {
        let path = format!("/v1/staff/players/{GABE}/bans");
        send(db, "POST", &path, token, Some(body)).await
    }

    #[sqlx::test]
    async fn a_players_log_and_invalidations_are_theirs_only(db: PgPool) {
        let key = setup(&db).await;
        let token = session(
            &db,
            STAFF,
            &[
                Privilege::ManageBans,
                Privilege::InvalidateRuns,
                Privilege::ManagePrivileges,
            ],
        )
        .await;
        let first = submit(&db, &key, "r1", 30.0).await;
        submit(&db, &key, "r2", 31.0).await;
        let path = format!("/v1/staff/runs/{}/invalidate", first["id"]);
        send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Zone" })),
        )
        .await;
        for player in [GABE, "76561197960287931"] {
            let path = format!("/v1/staff/players/{player}/privileges");
            let body = json!({ "grant": ["post_community"], "revoke": [], "reason": "Writer" });
            assert_eq!(
                send(&db, "POST", &path, &token, Some(body)).await.status,
                200
            );
        }
        let body = json!({ "restrictions": ["no_records"], "reason": "Cheating", "invalidate_runs": true });
        assert_eq!(post_ban(&db, &token, body).await.status, 201);
        crate::leaderboards::world_records::tests::assert_current(&db).await;

        let log: log::LogEntries = send(
            &db,
            "GET",
            &format!("/v1/staff/players/{GABE}/log"),
            &token,
            None,
        )
        .await
        .json();
        let actions: Vec<StaffAction> = log.entries.iter().map(|e| e.action).collect();
        assert_eq!(
            actions,
            [
                // A ban that takes the player's runs logs that as its own entry.
                StaffAction::InvalidatePlayerRuns,
                StaffAction::BanPlayer,
                StaffAction::GrantPrivileges,
                StaffAction::InvalidateRun
            ]
        );

        let list: Value = send(
            &db,
            "GET",
            &format!("/v1/staff/invalidations?player={GABE}"),
            &token,
            None,
        )
        .await
        .json();
        let actions: Vec<&str> = list["invalidations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["action"].as_str().unwrap())
            .collect();
        assert_eq!(actions, ["invalidate_player_runs", "invalidate_run"]);
        let other: Value = send(
            &db,
            "GET",
            "/v1/staff/invalidations?player=76561197960287931",
            &token,
            None,
        )
        .await
        .json();
        assert_eq!(other["invalidations"], json!([]));
    }

    #[sqlx::test]
    async fn a_ban_from_records_keeps_new_runs_off_the_boards_until_lifted(db: PgPool) {
        let key = setup(&db).await;
        // Every run's replay is wanted, so a banned run's missing upload link is the ban's doing.
        sqlx::query!(
            r#"INSERT INTO policies (name, version, value) VALUES ('replays', 99, '{"request": "every_run"}')"#
        )
        .execute(&db)
        .await
        .unwrap();
        let token = session(
            &db,
            STAFF,
            &[Privilege::ManageBans, Privilege::InvalidateRuns],
        )
        .await;
        submit(&db, &key, "before", 30.0).await;

        let body = json!({
            "restrictions": ["no_records"],
            "reason": "Cheating",
            "invalidate_runs": true,
        });
        let banned: Banned = post_ban(&db, &token, body).await.json();
        assert_eq!(banned.invalidated_runs, 1);
        assert_eq!(board(&db).await, [0.0; 0]);

        let during = submit(&db, &key, "during", 20.0).await;
        assert_eq!(during["personal_best"], false);
        assert_eq!(during["replay"], Value::Null);
        assert_eq!(board(&db).await, [0.0; 0]);
        let stored: Value = test_client::get(&db, &format!("/v1/runs/{}", during["id"]))
            .await
            .json();
        assert_eq!(stored["invalidated"], true);
        // A resend gets the same answer and changes nothing.
        let resent = test_client::post(&db, "/v1/runs", Some(&key), &run("during", 20.0)).await;
        assert_eq!(resent.status, 200);
        assert_eq!(resent.json::<Value>()["replay"], Value::Null);

        let player: StaffPlayer = send(
            &db,
            "GET",
            &format!("/v1/staff/players/{GABE}"),
            &token,
            None,
        )
        .await
        .json();
        let bans = player.bans.unwrap();
        assert!(bans[0].active);
        assert_eq!((player.valid_runs, player.invalidated_runs), (0, 2));

        let path = format!("/v1/staff/bans/{}/lift", banned.id);
        let lifted = send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Appeal" })),
        )
        .await;
        assert_eq!(lifted.status, 204);
        let again = send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Twice" })),
        )
        .await;
        assert_eq!(again.status, 422);

        // The runs the ban took stay out; a new one counts again.
        submit(&db, &key, "after", 40.0).await;
        assert_eq!(board(&db).await, [40.0]);

        let actions: Vec<String> = sqlx::query_scalar!("SELECT action FROM staff_log ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(
            actions,
            ["ban_player", "invalidate_player_runs", "lift_ban"]
        );
        let ended: Bans = send(&db, "GET", "/v1/staff/bans", &token, None)
            .await
            .json();
        assert!(ended.active.is_empty());
        assert_eq!(ended.ended[0].lift_reason.as_deref(), Some("Appeal"));
    }

    #[sqlx::test]
    async fn runs_sent_during_a_ban_can_be_restored_from_the_runs_page(db: PgPool) {
        let key = setup(&db).await;
        let token = session(
            &db,
            STAFF,
            &[Privilege::ManageBans, Privilege::InvalidateRuns],
        )
        .await;
        let body = json!({ "restrictions": ["no_records"], "reason": "Mistake" });
        post_ban(&db, &token, body).await;
        submit(&db, &key, "during", 20.0).await;

        let list: Value = send(&db, "GET", "/v1/staff/invalidations", &token, None)
            .await
            .json();
        let entry = &list["invalidations"][0];
        assert_eq!(entry["action"], "ban_player");
        assert_eq!(
            (entry["runs"].clone(), entry["still_invalid"].clone()),
            (json!(1), json!(1))
        );
        let path = format!("/v1/staff/invalidations/{}/restore", entry["id"]);
        let restored = send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Wrong player" })),
        )
        .await;
        assert_eq!(restored.status, 200);
        assert_eq!(board(&db).await, [20.0]);
    }

    #[sqlx::test]
    async fn a_ban_ends_on_its_date(db: PgPool) {
        let key = setup(&db).await;
        let gabe = SteamId64::parse_any(GABE).unwrap();
        crate::players::record_name(&mut db.acquire().await.unwrap(), gabe, "gabe", Utc::now())
            .await
            .unwrap();
        let log_id: i64 = sqlx::query_scalar!(
            "INSERT INTO staff_log (action, target, reason) VALUES ('ban_player', $1, 'Old') RETURNING id",
            GABE
        )
        .fetch_one(&db)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO bans (player_steamid64, restrictions, reason, banned_at, ends_at, log_id)
             VALUES ($1, 3, 'Old', now() - interval '2 days', now() - interval '1 day', $2)",
            gabe.get(),
            log_id
        )
        .execute(&db)
        .await
        .unwrap();
        submit(&db, &key, "after the end", 30.0).await;
        assert_eq!(board(&db).await, [30.0]);

        let token = session(&db, STAFF, &[Privilege::ManageBans]).await;
        let ban_id: i64 = sqlx::query_scalar!("SELECT id FROM bans")
            .fetch_one(&db)
            .await
            .unwrap();
        let path = format!("/v1/staff/bans/{ban_id}/lift");
        let lift = send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Late" })),
        )
        .await;
        assert_eq!(lift.status, 422);
        assert!(
            sqlx::query!("DELETE FROM bans").execute(&db).await.is_err(),
            "bans can't be deleted"
        );
    }

    #[sqlx::test]
    async fn a_ban_takes_runs_only_from_staff_who_may_invalidate_them(db: PgPool) {
        let key = setup(&db).await;
        let token = session(&db, STAFF, &[Privilege::ManageBans]).await;
        submit(&db, &key, "r1", 30.0).await;

        let body = json!({ "restrictions": ["no_records"], "reason": "Cheating", "invalidate_runs": true });
        assert_eq!(post_ban(&db, &token, body).await.status, 403);
        // Refused whole: no ban either, and the run stays on the board.
        let bans = sqlx::query_scalar!("SELECT count(*) FROM bans")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(bans, Some(0));
        assert_eq!(board(&db).await, [30.0]);

        let body = json!({ "restrictions": ["no_records"], "reason": "Cheating" });
        let banned: Banned = post_ban(&db, &token, body).await.json();
        assert_eq!(banned.invalidated_runs, 0);
    }

    #[sqlx::test]
    async fn a_ban_from_posting_stops_post_writes(db: PgPool) {
        let staff = session(&db, STAFF, &[Privilege::ManageBans]).await;
        let author = session(&db, GABE, &[Privilege::PostCommunity]).await;
        let article = json!({ "kind": "article", "title": "Hello", "body": "Text." });
        let created = send(&db, "POST", "/v1/posts", &author, Some(article.clone())).await;
        assert_eq!(created.status, 201);

        let body = json!({ "restrictions": ["no_posting"], "reason": "Spam" });
        let banned: Banned = post_ban(&db, &staff, body).await.json();
        let refused = send(&db, "POST", "/v1/posts", &author, Some(article.clone())).await;
        assert_eq!(refused.status, 403);
        let id = created.json::<Value>()["id"].clone();
        let id = id
            .as_i64()
            .map_or_else(|| id.as_str().unwrap().to_owned(), |n| n.to_string());
        let edit = send(
            &db,
            "PUT",
            &format!("/v1/posts/{id}"),
            &author,
            Some(article.clone()),
        )
        .await;
        assert_eq!(edit.status, 403);
        // Their post stays up.
        assert_eq!(
            test_client::get(&db, &format!("/v1/posts/{id}"))
                .await
                .status,
            200
        );

        let path = format!("/v1/staff/bans/{}/lift", banned.id);
        send(&db, "POST", &path, &staff, Some(json!({ "reason": "Ok" }))).await;
        let posted = send(&db, "POST", "/v1/posts", &author, Some(article)).await;
        assert_eq!(posted.status, 201);
    }

    #[sqlx::test]
    async fn bans_are_checked(db: PgPool) {
        let token = session(
            &db,
            STAFF,
            &[Privilege::ManageBans, Privilege::InvalidateRuns],
        )
        .await;
        for body in [
            json!({ "restrictions": [], "reason": "Nothing" }),
            json!({ "restrictions": ["no_records"], "reason": " " }),
            json!({ "restrictions": ["no_posting"], "reason": "Runs", "invalidate_runs": true }),
            json!({ "restrictions": ["no_records"], "reason": "Past", "ends_at": "2020-01-01T00:00:00Z" }),
        ] {
            assert_eq!(post_ban(&db, &token, body).await.status, 422);
        }
        let own = send(
            &db,
            "POST",
            &format!("/v1/staff/players/{STAFF}/bans"),
            &token,
            Some(json!({ "restrictions": ["no_records"], "reason": "Me" })),
        )
        .await;
        assert_eq!(own.status, 422);
        let not_a_player = send(
            &db,
            "POST",
            "/v1/staff/players/nobody/bans",
            &token,
            Some(json!({ "restrictions": ["no_records"], "reason": "Who" })),
        )
        .await;
        assert_eq!(not_a_player.status, 422);

        // A player SourceJump hasn't seen can be looked up and banned.
        let unseen = "76561197960287999";
        let path = format!("/v1/staff/players/{unseen}");
        let player: StaffPlayer = send(&db, "GET", &path, &token, None).await.json();
        assert!(!player.seen && player.bans.unwrap().is_empty());
        let body = json!({ "restrictions": ["no_records"], "reason": "Known cheater", "ends_at": "2099-01-01T00:00:00Z" });
        let banned = send(&db, "POST", &format!("{path}/bans"), &token, Some(body)).await;
        assert_eq!(banned.status, 201);

        // Banned staff can't lift their own ban.
        let other = session(&db, GABE, &[Privilege::ManageBans]).await;
        let body = json!({ "restrictions": ["no_posting"], "reason": "Staff ban" });
        let theirs: Banned = post_ban(&db, &token, body).await.json();
        let path = format!("/v1/staff/bans/{}/lift", theirs.id);
        let lift = send(
            &db,
            "POST",
            &path,
            &other,
            Some(json!({ "reason": "Mine" })),
        )
        .await;
        assert_eq!(lift.status, 422);
    }

    #[sqlx::test]
    async fn every_route_needs_its_privilege(db: PgPool) {
        let others: Vec<Privilege> = Privilege::ALL
            .into_iter()
            .filter(|&p| p.is_staff() && p != Privilege::ManageBans)
            .collect();
        let token = session(&db, STAFF, &others).await;
        let ban = json!({ "restrictions": ["no_records"], "reason": "Because" });
        for (method, path, body) in [
            ("GET", "/v1/staff/bans".to_owned(), None),
            ("POST", format!("/v1/staff/players/{GABE}/bans"), Some(ban)),
            (
                "POST",
                "/v1/staff/bans/1/lift".to_owned(),
                Some(json!({ "reason": "Because" })),
            ),
        ] {
            let response = send(&db, method, &path, &token, body).await;
            assert_eq!(response.status, 403, "{method} {path}");
        }
        // The player page shows runs to these staff, but not bans.
        let player: StaffPlayer = send(
            &db,
            "GET",
            &format!("/v1/staff/players/{GABE}"),
            &token,
            None,
        )
        .await
        .json();
        assert!(player.bans.is_none());
        let keys_only = session(&db, GABE, &[Privilege::ManageKeys]).await;
        let path = format!("/v1/staff/players/{STAFF}");
        assert_eq!(send(&db, "GET", &path, &keys_only, None).await.status, 403);
    }
}
