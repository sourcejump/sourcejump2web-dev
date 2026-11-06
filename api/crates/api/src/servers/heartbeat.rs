//! `POST /v1/servers/heartbeat`: what every server running the plugin reports on map start and every few
//! minutes, and what its key's status is.
//!
//! The key is optional: keyless servers send heartbeats too, so staff can list them on the site (the list is
//! a whitelist, separate from keys). A server is identified by its address, the IP the heartbeat came from
//! and the port it reports; a reported IP is stored for staff to read but never trusted. Its country is where
//! Cloudflare places that IP.

use std::time::{Duration, Instant};

use axum::{
    Json,
    extract::{DefaultBodyLimit, FromRequestParts, State},
    http::request::Parts,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, types::Json as JsonColumn};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::keys::{self, KeyLookup};
use crate::{
    app::AppState,
    client_address::{ClientAddress, ClientCountry},
    error::ApiError,
    json_body::JsonBody,
    maps::MapName,
};

/// How often servers should send a heartbeat besides map start. Sent in every answer, so it can change
/// without a plugin update.
const HEARTBEAT_SECONDS: u32 = 600;
/// Keyless heartbeats come from anyone, so one IP can hold at most this many ports.
const MAX_PORTS_PER_IP: i64 = 32;
const MAX_HOSTNAME_CHARS: usize = 64;
/// Anyone may send heartbeats, and each is stored, so they're held to well above what a server with a long
/// plugin list sends, far below axum's default of 2 MB.
const MAX_HEARTBEAT_BYTES: usize = 64 * 1024;
const PRUNE_INTERVAL: Duration = Duration::from_hours(1);

/// What the server is running and who's on it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HeartbeatRequest {
    /// The game port (`hostport`). With the IP the heartbeat came from, it identifies the server.
    pub port: u16,
    /// The server's own `ip` setting, if set. Shown to staff to spot servers behind NAT; never trusted.
    pub ip: Option<String>,
    /// The server's hostname as players see it. Control characters are removed and it's cut to 64 characters.
    pub hostname: String,
    /// Lowercase map name.
    #[schema(value_type = String, example = "bhop_badges")]
    pub map: MapName,
    /// Human players in the server, bots not counted.
    pub players: u8,
    pub max_slots: u8,
    pub plugin_version: String,
    pub sourcemod_version: String,
    /// None when the plugin can't find shavit. The heartbeat is still taken: that's a server staff need to see.
    pub shavit_version: Option<String>,
    /// The ruleset version the plugin applied, or none if it has never fetched one.
    pub ruleset_version: Option<i32>,
    /// Every loaded plugin, not only required ones, so staff can audit a server.
    pub plugins: Vec<LoadedPlugin>,
    pub compliance: ComplianceReport,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoadedPlugin {
    /// File name, e.g. `shavit-core.smx`.
    pub name: String,
    pub version: String,
    /// SHA-256 of the plugin file, hex.
    pub file_hash: String,
}

/// The plugin's own check of the server against the ruleset.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ComplianceReport {
    pub compliant: bool,
    /// What doesn't match the ruleset, for people to read. Empty when compliant.
    pub problems: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HeartbeatResponse {
    pub key: KeyStatus,
    /// Seconds until the next heartbeat, unless the map changes first.
    pub next_heartbeat_seconds: u32,
}

/// Whether the server may submit. Only `valid` allows keyed requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KeyStatus {
    Valid,
    Revoked,
    /// A key was sent, but it isn't one SourceJump issued.
    Unknown,
    /// No key was sent.
    None,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(heartbeat))
        .layer(DefaultBodyLimit::max(MAX_HEARTBEAT_BYTES))
}

/// Report the server's state and learn its key status. The key is optional.
#[utoipa::path(
    post,
    path = "/v1/servers/heartbeat",
    tag = "servers",
    request_body = HeartbeatRequest,
    responses(
        (status = OK, body = HeartbeatResponse),
        (status = PAYLOAD_TOO_LARGE, description = "Over 64 KB", body = crate::error::ErrorBody),
        (status = TOO_MANY_REQUESTS, description = "Over this address's heartbeat limit (`heartbeat_limit.rs`)", body = crate::error::ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid heartbeat", body = crate::error::ErrorBody),
    ),
    security((), ("server_key" = [])),
)]
async fn heartbeat(
    State(state): State<AppState>,
    ClientAddress(ip): ClientAddress,
    ClientCountry(country_code): ClientCountry,
    PresentedKey(presented): PresentedKey,
    JsonBody(mut report): JsonBody<HeartbeatRequest>,
) -> Result<Json<HeartbeatResponse>, ApiError> {
    if !state.heartbeat_limit.allow(ip, Instant::now()) {
        return Err(ApiError::TooManyRequests(
            "too many heartbeats from this address; a later regular one will be taken",
        ));
    }
    if report.port == 0 {
        return Err(ApiError::Invalid("port can't be 0".to_owned()));
    }
    report.hostname = clean_hostname(&report.hostname);
    // Looked up only now: anyone can send heartbeats, so the limit is checked before any database work.
    let lookup = match presented {
        None => None,
        Some(presented) => Some(keys::look_up(&state.db, &presented).await?),
    };
    let (key, server_id) = match lookup {
        None => (KeyStatus::None, None),
        Some(KeyLookup::Unknown) => (KeyStatus::Unknown, None),
        Some(KeyLookup::Revoked { .. }) => (KeyStatus::Revoked, None),
        Some(KeyLookup::Valid { server_id, .. }) => (KeyStatus::Valid, Some(server_id)),
    };

    let stored = sqlx::query!(
        r#"
        INSERT INTO server_heartbeats (ip, port, server_id, report, country_code)
        SELECT $1::inet, $2, $3, $4, $6
        WHERE EXISTS (SELECT 1 FROM server_heartbeats WHERE ip = $1::inet AND port = $2)
           OR (SELECT count(*) FROM server_heartbeats WHERE ip = $1::inet) < $5
        ON CONFLICT (ip, port) DO UPDATE
            SET server_id = excluded.server_id, report = excluded.report, country_code = excluded.country_code,
                received_at = now()
        "#,
        ip.to_string() as _,
        i32::from(report.port),
        server_id,
        JsonColumn(&report) as _,
        MAX_PORTS_PER_IP,
        country_code
    )
    .execute(&state.db)
    .await?;
    if stored.rows_affected() == 0 {
        // Still answered: the server's key status doesn't depend on being stored.
        tracing::warn!(%ip, port = report.port, "heartbeat not stored: too many ports on one IP");
    }
    // Only listed servers feed the activity chart, which is all it shows; it also keeps unlisted
    // senders, which anyone can be, from growing the log. The log serves up to a month, the daily totals
    // a year.
    sqlx::query!(
        r#"
        WITH listed AS (
            SELECT ip, port FROM server_listings WHERE ip = $1::inet AND port = $2
        ), logged AS (
            INSERT INTO server_heartbeat_log (ip, port, players) SELECT ip, port, $3 FROM listed
        )
        INSERT INTO server_activity_daily AS d (day, ip, port, players_sum, heartbeats)
        SELECT (now() AT TIME ZONE 'UTC')::date, ip, port, $3, 1 FROM listed
        ON CONFLICT (day, ip, port) DO UPDATE
            SET players_sum = d.players_sum + excluded.players_sum, heartbeats = d.heartbeats + 1
        "#,
        ip.to_string() as _,
        i32::from(report.port),
        i16::from(report.players)
    )
    .execute(&state.db)
    .await?;

    Ok(Json(HeartbeatResponse {
        key,
        next_heartbeat_seconds: HEARTBEAT_SECONDS,
    }))
}

/// Hostnames are shown on the site, so they're kept to one short line of printable text.
fn clean_hostname(hostname: &str) -> String {
    hostname
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_HOSTNAME_CHARS)
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Prunes every hour, for as long as the API runs. Not on each heartbeat: anyone can send those, and each
/// would cost three deletes.
pub async fn run(db: PgPool) {
    let mut ticks = tokio::time::interval(PRUNE_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        if let Err(error) = prune(&db).await {
            tracing::error!(%error, "pruning heartbeats failed; trying again later");
        }
    }
}

/// Forgets unlisted servers silent for a week, logged heartbeats after 30 days and daily totals after 400
/// days.
async fn prune(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM server_heartbeat_log WHERE received_at < now() - interval '30 days'")
        .execute(db)
        .await?;
    sqlx::query!("DELETE FROM server_activity_daily WHERE day < current_date - 400")
        .execute(db)
        .await?;
    sqlx::query!(
        r#"
        DELETE FROM server_heartbeats h
        WHERE received_at < now() - interval '7 days'
          AND NOT EXISTS (SELECT 1 FROM server_listings l WHERE l.ip = h.ip AND l.port = h.port)
        "#
    )
    .execute(db)
    .await?;
    Ok(())
}

/// The key the request sent, not yet looked up, or `None` when it sent none. Never rejects.
struct PresentedKey(Option<String>);

impl FromRequestParts<AppState> for PresentedKey {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> impl Future<Output = Result<Self, Self::Rejection>> {
        std::future::ready(Ok(Self(keys::bearer(parts).map(str::to_owned))))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::prune;
    use crate::{servers::keys, test_client};

    pub(crate) fn report(port: u16) -> Value {
        json!({
            "port": port,
            "ip": "10.0.0.5",
            "hostname": "Test server\n| 100 tick",
            "map": "bhop_Badges",
            "players": 12,
            "max_slots": 24,
            "plugin_version": "1.0.0",
            "sourcemod_version": "1.12.0.7210",
            "shavit_version": "4.0.1",
            "ruleset_version": 1,
            "plugins": [{ "name": "shavit-core.smx", "version": "4.0.1", "file_hash": "ab" }],
            "compliance": { "compliant": true, "problems": [] },
        })
    }

    /// A heartbeat as if from `ip`, through Caddy.
    pub(crate) async fn beat(db: &PgPool, ip: &str, key: Option<&str>, body: &Value) -> Value {
        beat_from(db, ip, None, key, body).await
    }

    /// A heartbeat as if from `ip` in `country`, through Cloudflare and Caddy.
    pub(crate) async fn beat_from(
        db: &PgPool,
        ip: &str,
        country: Option<&str>,
        key: Option<&str>,
        body: &Value,
    ) -> Value {
        let mut request = Request::post("/v1/servers/heartbeat")
            .header("content-type", "application/json")
            .header("x-forwarded-for", ip);
        if let Some(country) = country {
            request = request.header("cf-ipcountry", country);
        }
        if let Some(key) = key {
            request = request.header("authorization", format!("Bearer {key}"));
        }
        let response =
            test_client::send(db, request.body(Body::from(body.to_string())).unwrap()).await;
        assert_eq!(response.status, 200, "{:?}", response.body);
        response.json()
    }

    async fn stored(db: &PgPool) -> Vec<(String, i32, Option<i64>, Value)> {
        sqlx::query_as(
            "SELECT host(ip), port, server_id, report FROM server_heartbeats ORDER BY ip, port",
        )
        .fetch_all(db)
        .await
        .unwrap()
    }

    #[sqlx::test]
    async fn refuses_an_address_over_its_limit(db: PgPool) {
        // One state for every request, as in the running API, so the buckets carry over.
        let state = crate::app::AppState::for_tests(db.clone());
        let send = async |ip: &str| {
            let request = Request::post("/v1/servers/heartbeat")
                .header("content-type", "application/json")
                .header("x-forwarded-for", ip)
                .body(Body::from(report(27015).to_string()))
                .unwrap();
            test_client::send_to(state.clone(), request).await.status
        };
        assert_eq!(send("203.0.113.7").await, 200);
        // Spent here rather than by 120 requests, which take long enough to refill a few.
        let ip = "203.0.113.7".parse().unwrap();
        while state.heartbeat_limit.allow(ip, std::time::Instant::now()) {}
        assert_eq!(send("203.0.113.7").await, 429);
        assert_eq!(send("203.0.113.8").await, 200);
    }

    #[sqlx::test]
    async fn the_limit_is_checked_before_the_key_is_looked_up(db: PgPool) {
        let state = crate::app::AppState::for_tests(db.clone());
        let ip = "203.0.113.7".parse().unwrap();
        while state.heartbeat_limit.allow(ip, std::time::Instant::now()) {}
        // With the database gone, any query would answer 500: a 429 shows none was made.
        db.close().await;
        let request = Request::post("/v1/servers/heartbeat")
            .header("content-type", "application/json")
            .header("x-forwarded-for", "203.0.113.7")
            .header("authorization", "Bearer sj_not_a_real_key")
            .body(Body::from(report(27015).to_string()))
            .unwrap();
        assert_eq!(test_client::send_to(state, request).await.status, 429);
    }

    #[sqlx::test]
    async fn reports_the_key_status(db: PgPool) {
        let issued = keys::issue(&db, "Test server").await.unwrap();
        let revoked = keys::issue(&db, "Other server").await.unwrap();
        keys::revoke(&db, &revoked.prefix).await.unwrap();
        let status = |answer: Value| answer["key"].clone();

        let ip = "203.0.113.1";
        assert_eq!(
            status(beat(&db, ip, Some(&issued.key), &report(27015)).await),
            "valid"
        );
        assert_eq!(
            status(beat(&db, ip, Some(&revoked.key), &report(27015)).await),
            "revoked"
        );
        assert_eq!(
            status(beat(&db, ip, Some("sj_nope"), &report(27015)).await),
            "unknown"
        );
        let answer = beat(&db, ip, None, &report(27015)).await;
        assert_eq!(
            answer,
            json!({ "key": "none", "next_heartbeat_seconds": 600 })
        );
    }

    #[sqlx::test]
    async fn keeps_the_latest_heartbeat_per_address(db: PgPool) {
        let issued = keys::issue(&db, "Test server").await.unwrap();

        beat(&db, "203.0.113.1", None, &report(27015)).await;
        beat(&db, "203.0.113.1", Some(&issued.key), &report(27015)).await;
        beat(&db, "203.0.113.1", None, &report(27016)).await;
        beat(&db, "198.51.100.7", None, &report(27015)).await;

        let rows = stored(&db).await;
        let addresses: Vec<_> = rows
            .iter()
            .map(|(ip, port, server_id, _)| (ip.as_str(), *port, *server_id))
            .collect();
        assert_eq!(
            addresses,
            [
                ("198.51.100.7", 27015, None),
                ("203.0.113.1", 27015, Some(issued.server_id)),
                ("203.0.113.1", 27016, None),
            ]
        );
        let report = &rows[0].3;
        assert_eq!(report["hostname"], "Test server| 100 tick");
        assert_eq!(report["map"], "bhop_badges");
        assert_eq!(report["players"], 12);
    }

    #[sqlx::test]
    async fn takes_heartbeats_without_shavit(db: PgPool) {
        let mut no_shavit = report(27015);
        no_shavit["shavit_version"] = Value::Null;
        beat(&db, "203.0.113.1", None, &no_shavit).await;
        assert_eq!(stored(&db).await[0].3["shavit_version"], Value::Null);
    }

    #[sqlx::test]
    async fn caps_ports_per_ip_and_forgets_quiet_unlisted_servers(db: PgPool) {
        for port in 1..=33 {
            beat(&db, "203.0.113.1", None, &report(port)).await;
        }
        assert_eq!(stored(&db).await.len(), 32);

        sqlx::query(
            "UPDATE server_heartbeats SET received_at = now() - interval '8 days' WHERE port <= 2",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO server_listings (ip, port) VALUES ('203.0.113.1', 1)")
            .execute(&db)
            .await
            .unwrap();
        prune(&db).await.unwrap();

        let ports: Vec<_> = stored(&db).await.iter().map(|row| row.1).collect();
        assert!(ports.contains(&1), "listed servers are kept");
        assert!(!ports.contains(&2), "quiet unlisted servers are forgotten");
    }

    #[sqlx::test]
    async fn rejects_bad_heartbeats(db: PgPool) {
        let send = |body: Value| {
            let db = db.clone();
            async move {
                test_client::post(&db, "/v1/servers/heartbeat", None, &body)
                    .await
                    .status
            }
        };
        let mut no_port = report(0);
        no_port["port"] = json!(0);
        assert_eq!(send(no_port).await, 422);
        let mut bad_map = report(27015);
        bad_map["map"] = json!("../etc");
        assert_eq!(send(bad_map).await, 422);
        let mut too_many = report(27015);
        too_many["players"] = json!(300);
        assert_eq!(send(too_many).await, 422);
        let mut huge = report(27015);
        huge["compliance"]["problems"] = json!(vec!["x".repeat(1000); 100]);
        assert_eq!(send(huge).await, 413);
    }
}
