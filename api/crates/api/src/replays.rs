//! Replays SourceJump asks servers for: which runs' replays are wanted, and the link to upload each one to.
//!
//! Which replays are wanted, and which are public, is the `replays` policy (community policy, stored as data).
//! The game server uploads straight to object storage through a presigned link. A job then checks each upload
//! against its run and stores it as SJR (`replays/processing.rs`); downloads rebuild the shavit file
//! (`replays/download.rs`).
//!
//! The bucket is publicly readable, so every key holds a random part: an upload, or a replay that isn't
//! public, can only be found through the API.

pub mod download;
pub mod header;
pub mod processing;
pub mod route;
pub mod sjr;

use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, types::Json as JsonColumn};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    storage::{Staging, random_key_part},
};

// Plugins upload between runs, usually within minutes. A server that misses the window resends the run
// (which changes nothing else) and gets a fresh link.
const UPLOAD_LINK_LIFETIME: Duration = Duration::from_hours(1);

/// Larger uploads are refused unread. A technical limit, not a decision on very long runs (open):
/// about 9 hours at 100 tick.
pub const MAX_REPLAY_BYTES: usize = 128 * 1024 * 1024;

/// Where uploads land before they're checked.
pub const UPLOAD_PREFIX: &str = "uploads/replays/";

/// The `replays` policy value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReplayPolicy {
    #[serde(flatten)]
    pub request: ReplayRequest,
    /// Style keys whose replays anyone may download and watch. Others are kept but not handed out.
    #[serde(default)]
    pub public_styles: Vec<String>,
}

impl ReplayPolicy {
    pub fn wants(&self, new_personal_best: bool) -> bool {
        self.request.wants(new_personal_best)
    }

    pub fn is_public(&self, style: &str) -> bool {
        self.public_styles.iter().any(|public| public == style)
    }
}

/// Which runs' replays SourceJump asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "request", rename_all = "snake_case")]
pub enum ReplayRequest {
    NewPersonalBest,
    EveryRun,
    Nothing,
}

impl ReplayRequest {
    pub fn wants(self, new_personal_best: bool) -> bool {
        match self {
            Self::NewPersonalBest => new_personal_best,
            Self::EveryRun => true,
            Self::Nothing => false,
        }
    }
}

/// Where and until when the server may upload a run's replay.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ReplayUpload {
    /// Send the replay file with an HTTP `PUT` to this URL, without an `Authorization` header.
    pub upload_url: String,
    /// After this the URL stops working; resend the run to get a new one.
    pub expires_at: DateTime<Utc>,
    /// Set when an earlier upload of this replay failed its checks and was deleted, so the server can log why
    /// before it uploads again.
    pub last_refusal: Option<ReplayRefusal>,
}

/// Why the replay job refused a run's latest upload (`replays/processing.rs`).
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ReplayRefusal {
    /// For people to read; don't match on it.
    pub reason: String,
    pub refused_at: DateTime<Utc>,
}

/// A replay asked for and not stored yet.
pub struct Requested {
    pub upload_key: String,
    pub last_refusal: Option<ReplayRefusal>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(download::download_replay))
}

/// The replay policy in force. A missing policy asks for nothing and makes nothing public: no replay is
/// better than an unplanned flood or a leak.
pub async fn current_policy(conn: &mut PgConnection) -> Result<ReplayPolicy, sqlx::Error> {
    let value = sqlx::query_scalar!(
        r#"SELECT value AS "value: JsonColumn<ReplayPolicy>" FROM policies WHERE name = 'replays' ORDER BY version DESC LIMIT 1"#
    )
    .fetch_optional(conn)
    .await?;
    if value.is_none() {
        tracing::error!("no replays policy is published; no replays will be requested");
    }
    Ok(value.map_or(
        ReplayPolicy {
            request: ReplayRequest::Nothing,
            public_styles: Vec::new(),
        },
        |value| value.0,
    ))
}

/// Records that the run's replay is wanted and returns the object key the server uploads it to.
pub async fn request(conn: &mut PgConnection, run_id: i64) -> Result<String, sqlx::Error> {
    let upload_key = format!("{UPLOAD_PREFIX}{run_id}-{}.replay", random_key_part());
    sqlx::query!(
        "INSERT INTO replays (run_id, upload_key) VALUES ($1, $2)",
        run_id,
        upload_key
    )
    .execute(conn)
    .await?;
    Ok(upload_key)
}

/// Where the server uploads a replay asked for earlier, and why its last upload was refused, if it was. None
/// if it wasn't asked for, or is already stored: a stored replay never changes, so the server can delete its
/// copy.
pub async fn requested(
    conn: &mut PgConnection,
    run_id: i64,
) -> Result<Option<Requested>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT upload_key, refused_at, refused_reason FROM replays WHERE run_id = $1 AND stored_key IS NULL",
        run_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| Requested {
        upload_key: row.upload_key,
        last_refusal: row
            .refused_at
            .zip(row.refused_reason)
            .map(|(refused_at, reason)| ReplayRefusal { reason, refused_at }),
    }))
}

pub fn upload_link(staging: &Staging, requested: Requested, now: DateTime<Utc>) -> ReplayUpload {
    ReplayUpload {
        upload_url: staging.presign_put(&requested.upload_key, UPLOAD_LINK_LIFETIME),
        expires_at: now
            + TimeDelta::from_std(UPLOAD_LINK_LIFETIME).expect("one hour fits in a TimeDelta"),
        last_refusal: requested.last_refusal,
    }
}

#[cfg(test)]
mod tests {
    use super::{ReplayPolicy, ReplayRequest};

    #[test]
    fn policy_values_parse_from_their_stored_form() {
        let parse = |json: &str| serde_json::from_str::<ReplayPolicy>(json).unwrap();

        let first = parse(r#"{"request":"new_personal_best"}"#);
        assert_eq!(first.request, ReplayRequest::NewPersonalBest);
        assert!(
            !first.is_public("normal"),
            "nothing is public unless listed"
        );
        let current = parse(r#"{"request":"new_personal_best","public_styles":["normal"]}"#);
        assert!(current.is_public("normal") && !current.is_public("segmented"));
        assert_eq!(
            parse(r#"{"request":"every_run"}"#).request,
            ReplayRequest::EveryRun
        );
        assert_eq!(
            parse(r#"{"request":"nothing"}"#).request,
            ReplayRequest::Nothing
        );
        assert!(ReplayRequest::NewPersonalBest.wants(true));
        assert!(!ReplayRequest::NewPersonalBest.wants(false));
    }
}
