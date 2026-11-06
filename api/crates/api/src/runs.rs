//! Run submission, `POST /v1/runs`: keyed servers send each personal best on a ranked style. A server judges that
//! against the PB it last read from SourceJump, which can be stale (a faster run still in another server's queue),
//! so a run that isn't a PB here is stored and answered `personal_best: false`.
//!
//! Every run is counted once: the server's own run ID makes a resend return the first answer and change
//! nothing. In the same transaction as the run, the player's personal best is kept up to date and, if the
//! replay policy wants this run's replay, an upload link is issued. A run from a player banned from records is
//! stored invalid instead, answered like any other (so the plugin doesn't retry it), with no replay asked for.
//!
//! Reading one run back, `GET /v1/runs/{id}`, is in `runs/detail.rs`; the latest runs, `GET /v1/runs`, in
//! `runs/recent.rs`; its comments in `runs/comments.rs`; taking runs off the boards and back in `runs/invalidation.rs`.

pub mod comments;
mod detail;
pub mod invalidation;
mod recent;

use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, types::Json as JsonColumn};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    maps::{self, MapName},
    players::{self, SteamId64, restrictions},
    record_events,
    replays::{self, ReplayUpload},
    servers::{self, heartbeat::ComplianceReport, keys::ServerKey},
};

/// Servers report their tickrate as 1 / tick interval, a float, so a ruleset's tickrate is matched with the
/// same slack the replay check gives a replay's tickrate against its run.
const TICKRATE_TOLERANCE: f32 = 0.01;

/// A finished run, as the plugin sends it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunSubmission {
    /// The ID the game server gave this run (a UUID is a good choice). Unique per server; resending a run
    /// with the same ID is safe and returns the first answer.
    pub server_run_id: String,
    pub player: RunPlayer,
    /// Lowercase map name.
    #[schema(value_type = String, example = "bhop_badges")]
    pub map: MapName,
    /// SourceJump style key from the ruleset the run was played under.
    pub style: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i16,
    /// Seconds.
    pub time: f64,
    pub jumps: i32,
    pub strafes: i32,
    /// Percent, 0–100.
    pub sync: f32,
    /// Percent of perfect jumps, 0–100.
    pub perfs: f32,
    /// Units per second.
    pub avg_velocity: f32,
    /// Units per second.
    pub max_velocity: f32,
    pub tickrate: f32,
    /// When the run finished, in Unix seconds by the game server's clock.
    pub finished_at: i64,
    pub plugin_version: String,
    pub ruleset_version: i32,
    /// Fingerprint of the zones loaded when the run was played.
    pub zone_fingerprint: String,
    pub compliance: ComplianceReport,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunPlayer {
    #[schema(value_type = String, example = "76561197960287930")]
    pub steamid64: SteamId64,
    pub name: String,
}

/// SourceJump's answer to a run. A resend gets the same answer, with a fresh upload link if one applies.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunAccepted {
    /// SourceJump's ID for the run.
    pub id: i64,
    /// Whether this run is the player's SourceJump personal best on this map, style and track.
    pub personal_best: bool,
    /// Present when SourceJump wants this run's replay. Absent: delete the local copy.
    pub replay: Option<ReplayUpload>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(submit_run, recent::recent_runs))
        .routes(routes!(detail::run_detail))
        .routes(routes!(
            comments::list_run_comments,
            comments::create_run_comment
        ))
        .routes(routes!(comments::hide_run_comment))
        .routes(routes!(comments::list_run_comment_replies))
        .routes(routes!(comments::put_pinned_comment))
}

/// Submit a finished run. `2xx` means stored; a `4xx` other than `429` is final and the plugin shouldn't retry the run.
/// Network errors, `5xx` and `429` are temporary: keep the run queued and resend it.
#[utoipa::path(
    post,
    path = "/v1/runs",
    tag = "runs",
    request_body = RunSubmission,
    responses(
        (status = CREATED, description = "A new run was stored", body = RunAccepted),
        (status = OK, description = "This server sent this run before; nothing changed", body = RunAccepted),
        (status = UNAUTHORIZED, description = "Missing, unknown or revoked API key", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "The run breaks a rule and will never be accepted", body = ErrorBody),
    ),
    security(("server_key" = [])),
)]
async fn submit_run(
    State(state): State<AppState>,
    key: ServerKey,
    JsonBody(run): JsonBody<RunSubmission>,
) -> Result<(StatusCode, Json<RunAccepted>), ApiError> {
    check(&run).map_err(ApiError::Invalid)?;

    let mut tx = state.db.begin().await?;
    let stored = store(&mut tx, key, &run).await?;
    tx.commit().await?;

    let status = if stored.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    let replay = stored
        .replay
        .map(|requested| replays::upload_link(&state.staging, requested, Utc::now()));
    Ok((
        status,
        Json(RunAccepted {
            id: stored.id,
            personal_best: stored.personal_best,
            replay,
        }),
    ))
}

/// Rules a run must meet that its types can't express.
fn check(run: &RunSubmission) -> Result<(), String> {
    let text_fields = [
        ("server_run_id", &run.server_run_id, 64),
        ("player.name", &run.player.name, 128),
        ("style", &run.style, 32),
        ("plugin_version", &run.plugin_version, 32),
        ("zone_fingerprint", &run.zone_fingerprint, 128),
    ];
    for (field, value, max_len) in text_fields {
        if value.is_empty() || value.len() > max_len {
            return Err(format!("{field} must be 1 to {max_len} bytes"));
        }
    }
    if !(run.time.is_finite() && run.time > 0.0) {
        return Err("time must be a positive number of seconds".into());
    }
    if run.track < 0 || run.jumps < 0 || run.strafes < 0 {
        return Err("track, jumps and strafes can't be negative".into());
    }
    let percent = |value: f32| value.is_finite() && (0.0..=100.0).contains(&value);
    if !percent(run.sync) || !percent(run.perfs) {
        return Err("sync and perfs must be between 0 and 100".into());
    }
    let speed = |value: f32| value.is_finite() && value >= 0.0;
    if !speed(run.avg_velocity) || !speed(run.max_velocity) {
        return Err("velocities can't be negative".into());
    }
    if !(run.tickrate.is_finite() && run.tickrate > 0.0) {
        return Err("tickrate must be a positive number".into());
    }
    servers::server_time("finished_at", run.finished_at, Utc::now())?;
    // The plugin shouldn't send runs from a server that fails its own check; refuse them if it does.
    if !run.compliance.compliant {
        return Err("runs from a server that doesn't meet the ruleset are not accepted".into());
    }
    Ok(())
}

struct Stored {
    id: i64,
    created: bool,
    personal_best: bool,
    replay: Option<replays::Requested>,
}

async fn store(
    conn: &mut PgConnection,
    key: ServerKey,
    run: &RunSubmission,
) -> Result<Stored, ApiError> {
    if let Some(id) = existing(conn, key.server_id, &run.server_run_id).await? {
        return answer_for_existing(conn, id).await;
    }
    check_ruleset(conn, run).await?;

    let finished_at = DateTime::from_timestamp(run.finished_at, 0).expect("checked before storing");
    players::record_name(conn, run.player.steamid64, &run.player.name, finished_at).await?;
    let ban = restrictions::records_ban(conn, run.player.steamid64).await?;
    let map_id = maps::id_for(conn, &run.map).await?;

    let Some(id) = insert(conn, key, run, map_id, finished_at).await? else {
        // The same run arrived twice at once and the other request stored it first.
        let id = existing(conn, key.server_id, &run.server_run_id)
            .await?
            .expect("the conflicting run exists");
        return answer_for_existing(conn, id).await;
    };

    if let Some(ban_log_id) = ban {
        invalidation::store_invalid(conn, id, ban_log_id).await?;
        return Ok(Stored {
            id,
            created: true,
            personal_best: false,
            replay: None,
        });
    }

    // Also takes the map row lock that `world_records::refresh` relies on.
    maps::record_run(conn, map_id, finished_at).await?;
    let new_personal_best = record_personal_best(conn, run, map_id, id, finished_at).await?;
    if new_personal_best {
        record_events::record(conn, record_events::Kind::Run, &[id]).await?;
    }
    // Every valid run, not only personal bests: a run that arrives late may have been a record when it was set.
    crate::leaderboards::world_records::refresh(conn, &[id]).await?;
    let replay = if replays::current_policy(conn)
        .await?
        .wants(new_personal_best)
    {
        Some(replays::Requested {
            upload_key: replays::request(conn, id).await?,
            last_refusal: None,
        })
    } else {
        None
    };
    // Last: the recount holds the standings lock, which every other recount waits on, until this commits.
    if new_personal_best {
        crate::leaderboards::standings::refresh_runs(conn, &[id]).await?;
    }

    Ok(Stored {
        id,
        created: true,
        personal_best: new_personal_best,
        replay,
    })
}

/// Whether the run's ruleset version exists, ranks its style and, if it names one, allows its tickrate.
async fn check_ruleset(conn: &mut PgConnection, run: &RunSubmission) -> Result<(), ApiError> {
    let ruleset = sqlx::query!(
        r#"SELECT document->'styles' @> jsonb_build_array(jsonb_build_object('key', $2::text)) AS "ranked!",
                  (document->>'tickrate')::real AS tickrate
           FROM rulesets WHERE version = $1"#,
        run.ruleset_version,
        run.style
    )
    .fetch_optional(conn)
    .await?
    .ok_or_else(|| {
        ApiError::Invalid(format!(
            "there is no ruleset version {}",
            run.ruleset_version
        ))
    })?;
    if !ruleset.ranked {
        return Err(ApiError::Invalid(format!(
            "style {:?} is not ranked in ruleset version {}",
            run.style, run.ruleset_version
        )));
    }
    if let Some(tickrate) = ruleset.tickrate
        && (run.tickrate - tickrate).abs() > TICKRATE_TOLERANCE
    {
        return Err(ApiError::Invalid(format!(
            "ruleset version {} only ranks runs at tickrate {tickrate}",
            run.ruleset_version
        )));
    }
    Ok(())
}

/// Inserts the run; `None` if this server's run ID is already stored.
async fn insert(
    conn: &mut PgConnection,
    key: ServerKey,
    run: &RunSubmission,
    map_id: i64,
    finished_at: DateTime<Utc>,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO runs (
            server_id, key_id, server_run_id, player_steamid64, player_name, map_id, style, track, time,
            jumps, strafes, sync, perfs, avg_velocity, max_velocity, tickrate, finished_at, plugin_version,
            ruleset_version, zone_fingerprint, compliance
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (server_id, server_run_id) DO NOTHING
        RETURNING id
        "#,
        key.server_id,
        key.key_id,
        run.server_run_id,
        run.player.steamid64.get(),
        run.player.name,
        map_id,
        run.style,
        run.track,
        run.time,
        run.jumps,
        run.strafes,
        run.sync,
        run.perfs,
        run.avg_velocity,
        run.max_velocity,
        run.tickrate,
        finished_at,
        run.plugin_version,
        run.ruleset_version,
        run.zone_fingerprint,
        JsonColumn(&run.compliance) as _
    )
    .fetch_optional(conn)
    .await
}

/// Makes the run the player's personal best if it's faster, and says whether it did. Ties keep the
/// earlier run: a personal best only moves to a strictly faster time.
async fn record_personal_best(
    conn: &mut PgConnection,
    run: &RunSubmission,
    map_id: i64,
    run_id: i64,
    finished_at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let replaced = sqlx::query_scalar!(
        r#"
        INSERT INTO personal_bests (player_steamid64, map_id, style, track, run_id, time, finished_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (player_steamid64, map_id, style, track)
        DO UPDATE SET run_id = excluded.run_id, time = excluded.time, finished_at = excluded.finished_at
        WHERE excluded.time < personal_bests.time
        RETURNING run_id
        "#,
        run.player.steamid64.get(),
        map_id,
        run.style,
        run.track,
        run_id,
        run.time,
        finished_at
    )
    .fetch_optional(conn)
    .await?;
    Ok(replaced.is_some())
}

async fn existing(
    conn: &mut PgConnection,
    server_id: i64,
    server_run_id: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT id FROM runs WHERE server_id = $1 AND server_run_id = $2",
        server_id,
        server_run_id
    )
    .fetch_optional(conn)
    .await
}

async fn answer_for_existing(conn: &mut PgConnection, id: i64) -> Result<Stored, ApiError> {
    let personal_best = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM personal_bests WHERE run_id = $1) AS "exists!""#,
        id
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(Stored {
        id,
        created: false,
        personal_best,
        replay: replays::requested(conn, id).await?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::RunAccepted;
    use crate::{error::ErrorBody, servers::keys, test_client};

    /// Publishes a ruleset ranking `normal` and returns a fresh server key.
    pub(crate) async fn setup(db: &PgPool) -> String {
        sqlx::query(
            r#"INSERT INTO rulesets (version, document) VALUES (1, '{
                "plugin": {"min_version": "0.0.0"}, "cvars": {}, "plugins": {"required": [], "forbidden": []},
                "styles": [{"key": "normal", "name": "Normal", "settings": {}}],
                "zones": {"source_url": "http://localhost", "controlled_types": []}, "features": {}
            }')"#,
        )
        .execute(db)
        .await
        .unwrap();
        keys::issue(db, "Test server").await.unwrap().key
    }

    /// A valid run on `bhop_badges`, normal style, main track.
    pub(crate) fn run(server_run_id: &str, time: f64) -> Value {
        json!({
            "server_run_id": server_run_id,
            "player": { "steamid64": "76561197960287930", "name": "gabe" },
            "map": "bhop_badges",
            "style": "normal",
            "track": 0,
            "time": time,
            "jumps": 40, "strafes": 120, "sync": 91.5, "perfs": 88.0,
            "avg_velocity": 1100.0, "max_velocity": 2100.0, "tickrate": 100.0,
            "finished_at": 1_792_400_000,
            "plugin_version": "1.0.0",
            "ruleset_version": 1,
            "zone_fingerprint": "zf",
            "compliance": { "compliant": true, "problems": [] },
        })
    }

    async fn submit(db: &PgPool, key: &str, body: &Value) -> test_client::TestResponse {
        test_client::post(db, "/v1/runs", Some(key), body).await
    }

    async fn count(db: &PgPool, table: &str) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT count(*) FROM {table}")))
            .fetch_one(db)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn a_new_personal_best_is_stored_and_its_replay_requested(db: PgPool) {
        let key = setup(&db).await;

        let response = submit(&db, &key, &run("a", 30.0)).await;

        assert_eq!(response.status, 201);
        let accepted: RunAccepted = response.json();
        assert!(accepted.personal_best);
        let replay = accepted
            .replay
            .expect("a new personal best's replay is wanted");
        assert!(replay.upload_url.contains("replays/"));
        assert!(replay.upload_url.contains("X-Amz-Signature="));
    }

    #[sqlx::test]
    async fn a_resent_run_returns_the_first_answer_and_changes_nothing(db: PgPool) {
        let key = setup(&db).await;

        let first: RunAccepted = submit(&db, &key, &run("a", 30.0)).await.json();
        let again = submit(&db, &key, &run("a", 25.0)).await;

        assert_eq!(again.status, 200);
        let again: RunAccepted = again.json();
        assert_eq!(again.id, first.id);
        assert!(again.personal_best);
        assert!(again.replay.is_some());
        assert_eq!(count(&db, "runs").await, 1);
        let pb_time: f64 = sqlx::query_scalar("SELECT time FROM personal_bests")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!((pb_time - 30.0).abs() < f64::EPSILON);
    }

    #[sqlx::test]
    async fn only_a_faster_run_replaces_the_personal_best(db: PgPool) {
        let key = setup(&db).await;

        submit(&db, &key, &run("a", 30.0)).await;
        let slower: RunAccepted = submit(&db, &key, &run("b", 31.0)).await.json();
        let tie: RunAccepted = submit(&db, &key, &run("c", 30.0)).await.json();
        let faster: RunAccepted = submit(&db, &key, &run("d", 29.0)).await.json();

        assert!(!slower.personal_best && slower.replay.is_none());
        assert!(!tie.personal_best && tie.replay.is_none());
        assert!(faster.personal_best && faster.replay.is_some());
        assert_eq!(count(&db, "runs").await, 4);
        assert_eq!(count(&db, "personal_bests").await, 1);
        assert_eq!(count(&db, "replays").await, 2);
    }

    #[sqlx::test]
    async fn the_replay_policy_decides_which_replays_are_wanted(db: PgPool) {
        let key = setup(&db).await;
        sqlx::query("INSERT INTO policies (name, version, value) VALUES ('replays', 99, '{\"request\": \"every_run\"}')")
            .execute(&db)
            .await
            .unwrap();

        submit(&db, &key, &run("a", 30.0)).await;
        let slower: RunAccepted = submit(&db, &key, &run("b", 31.0)).await.json();

        assert!(slower.replay.is_some());
    }

    #[sqlx::test]
    async fn the_same_run_id_from_another_server_is_a_different_run(db: PgPool) {
        let key = setup(&db).await;
        let other = keys::issue(&db, "Other server").await.unwrap().key;

        let first: RunAccepted = submit(&db, &key, &run("a", 30.0)).await.json();
        let second = submit(&db, &other, &run("a", 31.0)).await;

        assert_eq!(second.status, 201);
        assert_ne!(second.json::<RunAccepted>().id, first.id);
    }

    #[sqlx::test]
    async fn runs_that_break_a_rule_are_refused_for_good(db: PgPool) {
        let key = setup(&db).await;
        let mut unranked = run("a", 30.0);
        unranked["style"] = json!("lowgrav");
        let mut unknown_ruleset = run("b", 30.0);
        unknown_ruleset["ruleset_version"] = json!(9);
        let mut not_compliant = run("c", 30.0);
        not_compliant["compliance"] = json!({ "compliant": false, "problems": ["sv_cheats is 1"] });
        let mut bad_steamid = run("d", 30.0);
        bad_steamid["player"]["steamid64"] = json!("STEAM_0:0:1");
        let mut zero_time = run("e", 30.0);
        zero_time["time"] = json!(0.0);
        let mut future = run("f", 30.0);
        future["finished_at"] = json!(chrono::Utc::now().timestamp() + 3600);

        for (body, expected) in [
            (unranked, "not ranked"),
            (unknown_ruleset, "no ruleset version 9"),
            (not_compliant, "doesn't meet the ruleset"),
            (bad_steamid, "SteamID64"),
            (zero_time, "positive number of seconds"),
            (future, "finished_at is in the future"),
        ] {
            let response = submit(&db, &key, &body).await;
            assert_eq!(response.status, 422, "{body}");
            let error: ErrorBody = response.json();
            assert!(
                error.error.contains(expected),
                "{} should mention {expected:?}",
                error.error
            );
        }
        assert_eq!(count(&db, "runs").await, 0);
    }

    #[sqlx::test]
    async fn a_ruleset_with_a_tickrate_ranks_runs_at_that_tickrate_only(db: PgPool) {
        let key = setup(&db).await;
        sqlx::query(
            r"INSERT INTO rulesets (version, document)
               SELECT 2, jsonb_set(document, '{tickrate}', '100') FROM rulesets WHERE version = 1",
        )
        .execute(&db)
        .await
        .unwrap();
        let at = |id: &str, tickrate: f64| {
            let mut body = run(id, 30.0);
            body["ruleset_version"] = json!(2);
            body["tickrate"] = json!(tickrate);
            body
        };

        let other = submit(&db, &key, &at("a", 66.666_664)).await;
        assert_eq!(other.status, 422);
        assert!(other.json::<ErrorBody>().error.contains("tickrate 100"));
        assert_eq!(submit(&db, &key, &at("b", 100.0)).await.status, 201);
        // Version 1 names no tickrate, so it takes any.
        let mut any = run("c", 31.0);
        any["tickrate"] = json!(66.666_664);
        assert_eq!(submit(&db, &key, &any).await.status, 201);
    }

    #[sqlx::test]
    async fn runs_need_a_valid_key(db: PgPool) {
        setup(&db).await;

        let response = test_client::post(&db, "/v1/runs", None, &run("a", 30.0)).await;

        assert_eq!(response.status, 401);
        assert_eq!(count(&db, "runs").await, 0);
    }
}
