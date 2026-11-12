//! The staff area's API: every route under `/v1/staff/`, each behind the `Staff` extractor (`staff/access.rs`),
//! and the staff log that records what staff do (`staff/log.rs`).
//!
//! A new staff action follows the same shape as the others: a function in `staff/<area>.rs` taking
//! `actor: Option<SteamId64>` (None is the CLI), making the change and its `log::record` in one transaction and
//! failing with `ChangeError`; the handler and any CLI command both call it. Append-only publishes take
//! `based_on`. Add a `StaffAction` (its name never changes) and its wording in the web's `LogEntry.tsx`, and
//! give every route a test that it refuses staff without its privilege.

pub mod access;
pub mod anticheat;
pub mod keys;
pub mod log;
pub mod map_edits;
pub mod map_images;
pub mod map_viewer_file;
pub mod maps;
pub mod players;
pub mod policies;
pub mod posts;
pub mod privileges;
pub mod run_comments;
pub mod runs;
pub mod servers;

use axum::extract::DefaultBodyLimit;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{app::AppState, error::ApiError};

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(log::list_log))
        .routes(routes!(keys::list_keys, keys::issue_key))
        .routes(routes!(keys::revoke_key))
        .routes(routes!(servers::list_staff_servers))
        .routes(routes!(servers::list_server, servers::unlist_server))
        .routes(routes!(servers::mark_whitelist, servers::mark_public))
        .routes(routes!(maps::list_staff_maps))
        .routes(routes!(maps::get_staff_map))
        .routes(routes!(maps::put_tier))
        .merge(
            // A picture is larger than the API's usual body limit.
            OpenApiRouter::new()
                .routes(routes!(map_images::post_image))
                .layer(DefaultBodyLimit::max(crate::maps::image::MAX_UPLOAD_BYTES)),
        )
        .routes(routes!(map_viewer_file::post_viewer_file_upload))
        .routes(routes!(map_viewer_file::put_viewer_file))
        .routes(routes!(map_viewer_file::list_viewer_files))
        .routes(routes!(map_images::delete_image))
        .routes(routes!(map_images::put_image_order))
        .routes(routes!(map_images::put_image_focus))
        .routes(routes!(maps::put_description))
        .routes(routes!(maps::put_release))
        .routes(routes!(maps::get_map_log))
        .routes(routes!(maps::post_zones))
        .routes(routes!(runs::post_invalidate_run))
        .routes(routes!(runs::post_restore_run))
        .routes(routes!(runs::get_run_log))
        .routes(routes!(run_comments::list_staff_run_comments))
        .routes(routes!(run_comments::list_staff_run_comment_replies))
        .routes(routes!(run_comments::post_hide_run_comment))
        .routes(routes!(run_comments::post_restore_run_comment))
        .routes(routes!(runs::list_invalidations, runs::post_invalidation))
        .routes(routes!(runs::get_invalidation_preview))
        .routes(routes!(runs::post_restore_invalidation))
        .routes(routes!(players::list_bans))
        .routes(routes!(players::get_staff_player))
        .routes(routes!(players::get_player_log))
        .routes(routes!(anticheat::get_player_detections))
        .routes(routes!(players::post_ban))
        .routes(routes!(players::post_lift_ban))
        .routes(routes!(privileges::post_privileges))
        .routes(routes!(posts::list_staff_posts))
        .routes(routes!(posts::get_staff_post))
        .routes(routes!(posts::post_hide_post))
        .routes(routes!(posts::post_restore_post))
}

/// Why a staff change didn't happen.
#[derive(Debug)]
pub enum ChangeError {
    /// Someone published another version after the one this was based on.
    Stale,
    /// It's the same as the version in force.
    Unchanged,
    Invalid(String),
    NotFound(&'static str),
    Database(sqlx::Error),
    /// Object storage failed, for changes that store files.
    Storage(crate::storage::StorageError),
}

impl From<sqlx::Error> for ChangeError {
    fn from(error: sqlx::Error) -> Self {
        // Two publishes racing for the same version number: the second one is stale.
        if let sqlx::Error::Database(db) = &error
            && db.is_unique_violation()
        {
            return Self::Stale;
        }
        Self::Database(error)
    }
}

impl From<ChangeError> for ApiError {
    fn from(error: ChangeError) -> Self {
        match error {
            ChangeError::Stale => ApiError::Conflict(
                "a newer version was published while you edited; reload to start from it",
            ),
            ChangeError::Unchanged => {
                ApiError::Invalid("nothing changed from the version in force".to_owned())
            }
            ChangeError::Invalid(message) => ApiError::Invalid(message),
            ChangeError::NotFound(message) => ApiError::NotFound(message),
            ChangeError::Database(error) => error.into(),
            ChangeError::Storage(error) => ApiError::Internal(error.into()),
        }
    }
}
