//! The staff log: recording each staff action in the transaction that makes it, and `GET /v1/staff/log` for
//! any staff member to read them, newest first, paging older and newer, by kind of action and by what or whom
//! they're about.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgConnection;
use utoipa::{IntoParams, ToSchema};

use super::access::Staff;
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::{PlayerRef, SteamId64},
};

const PAGE_SIZE: i64 = 50;

/// What a staff member did. Stored by name, so a variant keeps its name for good; new actions are added as
/// the staff tools grow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StaffAction {
    /// Gave a player privileges. Target: their SteamID64; detail: `privileges`.
    GrantPrivileges,
    /// Took privileges away. Target: their SteamID64; detail: `privileges`.
    RevokePrivileges,
    /// Issued an API key. Target: the key's prefix; detail: `server_id`, `server` (its name then).
    IssueKey,
    /// Revoked an API key. Target: the key's prefix; detail: `server_id`, `server`.
    RevokeKey,
    /// Issued a server a new key, revoking its old one. Target: the new key's prefix; detail: `server_id`,
    /// `server`, `replaced` (the old key's prefix).
    ReplaceKey,
    /// Put a server on the site's server list. Target: its `ip:port`.
    ListServer,
    /// Took a server off the list. Target: its `ip:port`.
    UnlistServer,
    /// Marked a listed server as letting in only players it has approved. Target: its `ip:port`.
    MarkServerWhitelist,
    /// Marked a listed server as open to everyone again. Target: its `ip:port`.
    MarkServerPublic,
    /// Published a ruleset version. Target: the version; reason: what changed.
    PublishRuleset,
    /// Published a policy version. Target: the policy's name; detail: `version`, `value`.
    PublishPolicy,
    /// Rated a map's track. Target: the map; detail: `track`, `tier`, and from 2026-11-12 `previous` (the tier
    /// it replaced; null when the track had none).
    SetTier,
    /// Set or cleared a map's one image, before maps held several. No longer made; kept so earlier entries
    /// still read. Detail: `image` (a storage key) or, from before uploads, `image_url`.
    SetMapImage,
    /// Added a picture to a map. Target: the map; detail: `image` (its storage key), `cover` (whether it
    /// became the cover).
    AddMapImage,
    /// Removed one of a map's pictures. Target: the map; detail: `image`, `cover` (whether it was the cover).
    RemoveMapImage,
    /// Reordered a map's pictures. Target: the map; detail: `images` (their keys in the new order).
    OrderMapImages,
    /// Moved which strip of a picture a short banner shows. Target: the map; detail: `image`, `focus`.
    SetBannerFocus,
    /// Set or cleared a map's description. Target: the map; detail: `description`.
    SetMapDescription,
    /// Set when a map was released and who made it. Target: the map; detail: `released` (`year`, `month`,
    /// `day`), `mapper` (a SteamID64), each null when unknown.
    SetMapRelease,
    /// Published a map's zone set. Target: the map; detail: `version`; reason: what changed.
    PublishZones,
    /// Uploaded a map's file for the replay viewer and zone editor. Target: the map; detail: `file` (its storage
    /// key), `bytes`.
    UploadViewerFile,
    /// Took one run off the boards. Target: the run ID; detail: `player`, `player_name`, `map`, `style`,
    /// `track`, `time`.
    InvalidateRun,
    /// Took every valid run of a player off the boards. Target: their SteamID64; detail: `runs` (how many).
    InvalidatePlayerRuns,
    /// Took every valid run sent with a key off the boards. Target: the key's prefix; detail: `runs`,
    /// `server_id`, `server`. No longer made, since a server's runs are invalidated together; kept so earlier
    /// entries still read and restore.
    InvalidateKeyRuns,
    /// Took every valid run a server sent, with any of its keys, off the boards. Target: the server's ID;
    /// detail: `runs`, `server_id`, `server`.
    InvalidateServerRuns,
    /// Put one run back on the boards. Target: the run ID; detail as for `invalidate_run`.
    RestoreRun,
    /// Put back the runs a player's, server's or key's invalidation took that were still invalid. Target: as
    /// that invalidation's; detail: `invalidation` (its log entry ID), `runs`, and `server` (its name) for a
    /// server's or key's.
    RestoreRuns,
    /// Banned a player. Target: their SteamID64; detail: `restrictions`, `ends_at` (null: until lifted).
    /// Runs they submit while banned from records name this entry as what invalidated them.
    BanPlayer,
    /// Lifted a ban. Target: the player's SteamID64; detail: `ban` (its ID), `restrictions`.
    LiftBan,
    /// Removed someone else's community post from the site. Target: the post ID; detail: `title`, `author`
    /// (SteamID64), `author_name`.
    HidePost,
    /// Put a post staff removed back on the site. Target: the post ID; detail as for `hide_post`.
    RestorePost,
    /// Edited someone else's community post. Target: the post ID; detail: `title`, `previous_title`,
    /// `author`, `author_name`, `changed` (of `kind`, `title`, `body`, `video`).
    EditPost,
    /// Changed someone else's profile details. Target: their SteamID64; detail: `changed` (field names),
    /// `before` (the details as they were).
    EditPlayerDetails,
    /// Removed someone else's comment on a run. Target: the comment ID; detail: `run` (its ID), `body`,
    /// `author` (SteamID64), `author_name`.
    HideRunComment,
    /// Put a comment staff removed back on its run's page. Target: the comment ID; detail as for
    /// `hide_run_comment`.
    RestoreRunComment,
}

impl StaffAction {
    const ALL: [Self; 35] = [
        Self::GrantPrivileges,
        Self::RevokePrivileges,
        Self::IssueKey,
        Self::RevokeKey,
        Self::ReplaceKey,
        Self::ListServer,
        Self::UnlistServer,
        Self::MarkServerWhitelist,
        Self::MarkServerPublic,
        Self::PublishRuleset,
        Self::PublishPolicy,
        Self::SetTier,
        Self::SetMapImage,
        Self::AddMapImage,
        Self::RemoveMapImage,
        Self::OrderMapImages,
        Self::SetBannerFocus,
        Self::SetMapDescription,
        Self::SetMapRelease,
        Self::PublishZones,
        Self::UploadViewerFile,
        Self::InvalidateRun,
        Self::InvalidatePlayerRuns,
        Self::InvalidateKeyRuns,
        Self::InvalidateServerRuns,
        Self::RestoreRun,
        Self::RestoreRuns,
        Self::BanPlayer,
        Self::LiftBan,
        Self::HidePost,
        Self::RestorePost,
        Self::EditPost,
        Self::EditPlayerDetails,
        Self::HideRunComment,
        Self::RestoreRunComment,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::GrantPrivileges => "grant_privileges",
            Self::RevokePrivileges => "revoke_privileges",
            Self::IssueKey => "issue_key",
            Self::RevokeKey => "revoke_key",
            Self::ReplaceKey => "replace_key",
            Self::ListServer => "list_server",
            Self::UnlistServer => "unlist_server",
            Self::MarkServerWhitelist => "mark_server_whitelist",
            Self::MarkServerPublic => "mark_server_public",
            Self::PublishRuleset => "publish_ruleset",
            Self::PublishPolicy => "publish_policy",
            Self::SetTier => "set_tier",
            Self::SetMapImage => "set_map_image",
            Self::AddMapImage => "add_map_image",
            Self::RemoveMapImage => "remove_map_image",
            Self::OrderMapImages => "order_map_images",
            Self::SetBannerFocus => "set_banner_focus",
            Self::SetMapDescription => "set_map_description",
            Self::SetMapRelease => "set_map_release",
            Self::PublishZones => "publish_zones",
            Self::UploadViewerFile => "upload_viewer_file",
            Self::InvalidateRun => "invalidate_run",
            Self::InvalidatePlayerRuns => "invalidate_player_runs",
            Self::InvalidateKeyRuns => "invalidate_key_runs",
            Self::InvalidateServerRuns => "invalidate_server_runs",
            Self::RestoreRun => "restore_run",
            Self::RestoreRuns => "restore_runs",
            Self::BanPlayer => "ban_player",
            Self::LiftBan => "lift_ban",
            Self::HidePost => "hide_post",
            Self::RestorePost => "restore_post",
            Self::EditPost => "edit_post",
            Self::EditPlayerDetails => "edit_player_details",
            Self::HideRunComment => "hide_run_comment",
            Self::RestoreRunComment => "restore_run_comment",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.name() == name)
    }

    /// Whether the target is a player's SteamID64, so the log can show who it was.
    fn targets_player(self) -> bool {
        match self {
            // A restore's target can be a key prefix or a server ID too; neither ever matches a SteamID64.
            Self::GrantPrivileges
            | Self::RevokePrivileges
            | Self::InvalidatePlayerRuns
            | Self::RestoreRuns
            | Self::BanPlayer
            | Self::LiftBan
            | Self::EditPlayerDetails => true,
            Self::IssueKey
            | Self::RevokeKey
            | Self::ReplaceKey
            | Self::ListServer
            | Self::UnlistServer
            | Self::MarkServerWhitelist
            | Self::MarkServerPublic
            | Self::PublishRuleset
            | Self::PublishPolicy
            | Self::SetTier
            | Self::SetMapImage
            | Self::AddMapImage
            | Self::RemoveMapImage
            | Self::OrderMapImages
            | Self::SetBannerFocus
            | Self::SetMapDescription
            | Self::SetMapRelease
            | Self::PublishZones
            | Self::UploadViewerFile
            | Self::InvalidateRun
            | Self::InvalidateKeyRuns
            | Self::InvalidateServerRuns
            | Self::RestoreRun
            | Self::HidePost
            | Self::RestorePost
            | Self::EditPost
            | Self::HideRunComment
            | Self::RestoreRunComment => false,
        }
    }
}

/// What part of the site an action is about, for reading the log one kind at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LogKind {
    /// Privileges, bans and profile details.
    Players,
    /// Runs taken off the boards and put back.
    Runs,
    /// Keys and the server list.
    Servers,
    /// Tiers, pictures, descriptions, zones and viewer files.
    Maps,
    /// The ruleset and policies.
    Rules,
    Posts,
}

impl StaffAction {
    fn kind(self) -> LogKind {
        match self {
            Self::GrantPrivileges
            | Self::RevokePrivileges
            | Self::BanPlayer
            | Self::LiftBan
            | Self::EditPlayerDetails => LogKind::Players,
            Self::InvalidateRun
            | Self::InvalidatePlayerRuns
            | Self::InvalidateKeyRuns
            | Self::InvalidateServerRuns
            | Self::RestoreRun
            | Self::RestoreRuns => LogKind::Runs,
            Self::IssueKey
            | Self::RevokeKey
            | Self::ReplaceKey
            | Self::ListServer
            | Self::UnlistServer
            | Self::MarkServerWhitelist
            | Self::MarkServerPublic => LogKind::Servers,
            Self::SetTier
            | Self::SetMapImage
            | Self::AddMapImage
            | Self::RemoveMapImage
            | Self::OrderMapImages
            | Self::SetBannerFocus
            | Self::SetMapDescription
            | Self::SetMapRelease
            | Self::PublishZones
            | Self::UploadViewerFile => LogKind::Maps,
            Self::PublishRuleset | Self::PublishPolicy => LogKind::Rules,
            Self::HidePost
            | Self::RestorePost
            | Self::EditPost
            | Self::HideRunComment
            | Self::RestoreRunComment => LogKind::Posts,
        }
    }
}

const MAX_REASON_CHARS: usize = 500;

/// Checks a reason a staff member gave, trimmed. Actions that need one call this at the boundary.
pub fn check_reason(reason: &str) -> Result<String, ApiError> {
    let reason = reason.trim();
    if reason.is_empty() || reason.chars().count() > MAX_REASON_CHARS {
        return Err(ApiError::Invalid(format!(
            "give a reason of 1 to {MAX_REASON_CHARS} characters"
        )));
    }
    Ok(reason.to_owned())
}

/// One action to record.
pub struct Entry<'a> {
    /// None for the command line.
    pub actor: Option<SteamId64>,
    pub action: StaffAction,
    pub target: &'a str,
    pub reason: Option<&'a str>,
    pub detail: Value,
}

/// Records an action and returns its entry's ID. Call it on the transaction that makes the change, so neither
/// lands without the other. A map edit made on the site is queued for the Discord map-edits feed too.
pub async fn record(conn: &mut PgConnection, entry: Entry<'_>) -> Result<i64, sqlx::Error> {
    let posts_to_discord = entry.actor.is_some() && super::map_edits::feeds(entry.action);
    let id = sqlx::query_scalar!(
        "INSERT INTO staff_log (actor_steamid64, action, target, reason, detail) VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
        entry.actor.map(SteamId64::get),
        entry.action.name(),
        entry.target,
        entry.reason,
        entry.detail
    )
    .fetch_one(&mut *conn)
    .await?;
    if posts_to_discord {
        super::map_edits::queue(conn, id).await?;
    }
    Ok(id)
}

/// A recorded staff action.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffLogEntry {
    pub id: i64,
    /// Who did it; null when it was done with the server's command line.
    pub actor: Option<PlayerRef>,
    pub action: StaffAction,
    /// What it was done to; what kind of thing depends on the action.
    pub target: String,
    /// The player it was done to, for actions on a player.
    pub target_player: Option<PlayerRef>,
    pub reason: Option<String>,
    /// The specifics; their shape depends on the action.
    #[schema(value_type = Object)]
    pub detail: Value,
    pub at: DateTime<Utc>,
}

/// The entries about one thing, such as a run, player or map, for its page: 50 at a time, newest first.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LogEntries {
    /// Newest first.
    pub entries: Vec<StaffLogEntry>,
    /// Pass as `before` for the next 50 older entries; null when there are none.
    pub older: Option<String>,
}

impl LogEntries {
    /// From up to `PAGE_SIZE + 1` rows: the extra one only says that an older page exists.
    fn page(rows: Vec<LogRow>) -> Result<Self, ApiError> {
        let mut entries = LogRow::into_entries(rows)?;
        let older = if entries.len() > usize::try_from(PAGE_SIZE).expect("small") {
            entries.truncate(entries.len() - 1);
            entries.last().map(|entry| entry.id.to_string())
        } else {
            None
        };
        Ok(Self { entries, older })
    }
}

/// Paging for the entries about one thing.
#[derive(Debug, Deserialize, IntoParams)]
pub struct EntriesQuery {
    /// From a page's `older`: the entries before it.
    before: Option<String>,
}

impl EntriesQuery {
    /// The entry ID a page starts below.
    pub fn before(&self) -> Result<i64, ApiError> {
        self.before.as_deref().map_or(Ok(i64::MAX), |cursor| {
            cursor
                .parse()
                .map_err(|_| ApiError::Invalid("that isn't a staff log cursor".to_owned()))
        })
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffLog {
    /// Newest first.
    pub entries: Vec<StaffLogEntry>,
    /// Pass as `before` for the page of older entries; null when there are none.
    pub older: Option<String>,
    /// Pass as `after` for the page of newer entries; null when this page holds the newest.
    pub newer: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct LogQuery {
    /// From a page's `older`: the entries before it.
    before: Option<String>,
    /// From a page's `newer`: the entries after it. Not with `before`.
    after: Option<String>,
    /// Only this kind of action.
    #[param(inline)]
    kind: Option<LogKind>,
    /// Only entries about this. A `SteamID`, in any form, finds what the player did and what was done to them or
    /// their runs and posts. Anything else is matched with the target (a map, run or post ID, key prefix,
    /// server address or policy) and with a server's ID or name.
    about: Option<String>,
}

/// The `about` filter, worked out once.
struct About {
    /// A SteamID64 as text, for targets and details, or the text as given.
    text: String,
    player: Option<i64>,
}

impl About {
    fn parse(about: Option<&str>) -> Option<Self> {
        let about = about.map(str::trim).filter(|about| !about.is_empty())?;
        let player = SteamId64::parse_any(about);
        Some(Self {
            text: player.map_or_else(|| about.to_owned(), |player| player.to_string()),
            player: player.map(SteamId64::get),
        })
    }
}

/// Where a page starts. Cursors are entry IDs, which only grow, so a page never skips or repeats an entry
/// when new ones are logged while a staff member reads.
enum Page {
    Before(i64),
    After(i64),
}

impl Page {
    fn from_query(query: LogQuery) -> Result<Self, ApiError> {
        let id = |cursor: String| {
            cursor
                .parse::<i64>()
                .map_err(|_| ApiError::Invalid("that isn't a staff log cursor".to_owned()))
        };
        match (query.before, query.after) {
            (Some(_), Some(_)) => Err(ApiError::Invalid(
                "pass either before or after, not both".to_owned(),
            )),
            (Some(before), None) => Ok(Self::Before(id(before)?)),
            (None, Some(after)) => Ok(Self::After(id(after)?)),
            (None, None) => Ok(Self::Before(i64::MAX)),
        }
    }
}

/// The staff log, newest first, 50 entries a page. Any staff member may read it.
#[utoipa::path(
    get,
    path = "/v1/staff/log",
    tag = "staff",
    params(LogQuery),
    responses(
        (status = OK, body = StaffLog),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not staff", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a cursor from this list, or both cursors", body = ErrorBody),
    ),
)]
pub async fn list_log(
    State(state): State<AppState>,
    _staff: Staff,
    Query(query): Query<LogQuery>,
) -> Result<Json<StaffLog>, ApiError> {
    let actions: Option<Vec<String>> = query.kind.map(|kind| {
        StaffAction::ALL
            .into_iter()
            .filter(|action| action.kind() == kind)
            .map(|action| action.name().to_owned())
            .collect()
    });
    let about = About::parse(query.about.as_deref());
    let (about_text, about_player) = (
        about.as_ref().map(|a| a.text.clone()),
        about.and_then(|a| a.player),
    );
    // A newer page is read oldest first from its cursor, so it holds the entries right after it.
    let (before, after, oldest_first) = match Page::from_query(query)? {
        Page::Before(id) => (id, 0, false),
        Page::After(id) => (i64::MAX, id, true),
    };
    let rows = sqlx::query_as!(
        LogRow,
        r#"
        SELECT l.id, l.action, l.target, l.reason, l.detail, l.at,
               a.steamid64::text AS "actor_steamid64?", a.name AS "actor_name?",
               a.avatar_url AS actor_avatar_url, a.country_code AS actor_country_code,
               t.steamid64::text AS "target_steamid64?", t.name AS "target_name?",
               t.avatar_url AS target_avatar_url, t.country_code AS target_country_code
        FROM staff_log l
        LEFT JOIN players a ON a.steamid64 = l.actor_steamid64
        -- Only actions on a player have a SteamID64 as their target; a run ID could look like one.
        LEFT JOIN players t ON l.action = ANY($4) AND t.steamid64::text = l.target
        WHERE l.id < $1 AND l.id > $2
          AND ($6::text[] IS NULL OR l.action = ANY($6))
          AND ($7::text IS NULL OR l.target = $7 OR l.actor_steamid64 = $8
               OR l.detail->>'player' = $7 OR l.detail->>'author' = $7
               OR (NOT $9 AND (l.detail->>'server_id' = $7 OR lower(l.detail->>'server') = lower($7))))
        ORDER BY CASE WHEN $5 THEN l.id ELSE -l.id END
        LIMIT $3
        "#,
        before,
        after,
        PAGE_SIZE,
        &player_actions()[..],
        oldest_first,
        actions.as_deref(),
        about_text.as_deref(),
        about_player,
        about_player.is_some()
    )
    .fetch_all(&state.db)
    .await?;

    let mut entries = LogRow::into_entries(rows)?;
    if oldest_first {
        entries.reverse();
    }

    // Two lookups, filtered like the page, say exactly whether anything lies past either end of it.
    let (Some(newest), Some(oldest)) = (entries.first(), entries.last()) else {
        return Ok(Json(StaffLog {
            entries,
            older: None,
            newer: None,
        }));
    };
    let (newest, oldest) = (newest.id, oldest.id);
    let ends = sqlx::query!(
        r#"
        WITH matching AS (
            SELECT l.id FROM staff_log l
            WHERE ($3::text[] IS NULL OR l.action = ANY($3))
              AND ($4::text IS NULL OR l.target = $4 OR l.actor_steamid64 = $5
                   OR l.detail->>'player' = $4 OR l.detail->>'author' = $4
                   OR (NOT $6 AND (l.detail->>'server_id' = $4 OR lower(l.detail->>'server') = lower($4))))
        )
        SELECT EXISTS (SELECT 1 FROM matching WHERE id < $1) AS "older!",
               EXISTS (SELECT 1 FROM matching WHERE id > $2) AS "newer!"
        "#,
        oldest,
        newest,
        actions.as_deref(),
        about_text.as_deref(),
        about_player,
        about_player.is_some()
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(StaffLog {
        entries,
        older: ends.older.then(|| oldest.to_string()),
        newer: ends.newer.then(|| newest.to_string()),
    }))
}

/// The names of the actions whose target is a player's SteamID64, for joining the player in.
fn player_actions() -> Vec<String> {
    StaffAction::ALL
        .into_iter()
        .filter(|action| action.targets_player())
        .map(|action| action.name().to_owned())
        .collect()
}

/// A log entry as read, with its actor and target player from LEFT JOINs. Every query that reads entries
/// selects these columns, so they all turn into `StaffLogEntry` the same way.
struct LogRow {
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
    target_steamid64: Option<String>,
    target_name: Option<String>,
    target_avatar_url: Option<String>,
    target_country_code: Option<String>,
}

impl LogRow {
    fn into_entries(rows: Vec<Self>) -> Result<Vec<StaffLogEntry>, ApiError> {
        rows.into_iter().map(Self::into_entry).collect()
    }

    fn into_entry(self) -> Result<StaffLogEntry, ApiError> {
        let action = StaffAction::from_name(&self.action).ok_or_else(|| {
            ApiError::Internal(format!("unknown staff action {:?}", self.action).into())
        })?;
        Ok(StaffLogEntry {
            id: self.id,
            actor: player_ref(
                self.actor_steamid64,
                self.actor_name,
                self.actor_avatar_url,
                self.actor_country_code,
            ),
            action,
            target: self.target,
            target_player: player_ref(
                self.target_steamid64,
                self.target_name,
                self.target_avatar_url,
                self.target_country_code,
            ),
            reason: self.reason,
            detail: self.detail,
            at: self.at,
        })
    }
}

/// The entries about one run, newest first: its own invalidations and restores, removals and restores of its
/// comments, and the action that
/// invalidated it when that was a player's, server's or key's invalidation or a ban. Once such an action is
/// restored the run no longer names it, so it drops out of this list; the full log still holds it.
pub(super) async fn run_entries(
    db: &sqlx::PgPool,
    run_id: i64,
    before: i64,
) -> Result<LogEntries, ApiError> {
    let rows = sqlx::query_as!(
        LogRow,
        r#"
        SELECT l.id, l.action, l.target, l.reason, l.detail, l.at,
               a.steamid64::text AS "actor_steamid64?", a.name AS "actor_name?",
               a.avatar_url AS actor_avatar_url, a.country_code AS actor_country_code,
               t.steamid64::text AS "target_steamid64?", t.name AS "target_name?",
               t.avatar_url AS target_avatar_url, t.country_code AS target_country_code
        FROM staff_log l
        LEFT JOIN players a ON a.steamid64 = l.actor_steamid64
        LEFT JOIN players t ON l.action = ANY($3) AND t.steamid64::text = l.target
        WHERE ((l.action = ANY($2) AND l.target = $1::bigint::text)
               OR (l.action = ANY($6) AND l.detail->>'run' = $1::bigint::text)
               OR l.id = (SELECT invalidated_by FROM runs WHERE id = $1))
          AND l.id < $4
        ORDER BY l.id DESC
        LIMIT $5
        "#,
        run_id,
        &[
            StaffAction::InvalidateRun.name().to_owned(),
            StaffAction::RestoreRun.name().to_owned(),
        ][..],
        &player_actions()[..],
        before,
        PAGE_SIZE + 1,
        &[
            StaffAction::HideRunComment.name().to_owned(),
            StaffAction::RestoreRunComment.name().to_owned(),
        ][..]
    )
    .fetch_all(db)
    .await?;
    LogEntries::page(rows)
}

/// The entries about one player, newest first: actions on them (privileges, bans, their runs as a
/// whole), on one of their runs, and on one of their posts or run comments.
pub(super) async fn player_entries(
    db: &sqlx::PgPool,
    player: SteamId64,
    before: i64,
) -> Result<LogEntries, ApiError> {
    let run_actions = [StaffAction::InvalidateRun, StaffAction::RestoreRun].map(StaffAction::name);
    let post_actions = [
        StaffAction::HidePost,
        StaffAction::RestorePost,
        StaffAction::EditPost,
        StaffAction::HideRunComment,
        StaffAction::RestoreRunComment,
    ]
    .map(StaffAction::name);
    let rows = sqlx::query_as!(
        LogRow,
        r#"
        SELECT l.id, l.action, l.target, l.reason, l.detail, l.at,
               a.steamid64::text AS "actor_steamid64?", a.name AS "actor_name?",
               a.avatar_url AS actor_avatar_url, a.country_code AS actor_country_code,
               t.steamid64::text AS "target_steamid64?", t.name AS "target_name?",
               t.avatar_url AS target_avatar_url, t.country_code AS target_country_code
        FROM staff_log l
        LEFT JOIN players a ON a.steamid64 = l.actor_steamid64
        LEFT JOIN players t ON l.action = ANY($2) AND t.steamid64::text = l.target
        WHERE ((l.action = ANY($2) AND l.target = $1::bigint::text)
               OR (l.action = ANY($3) AND l.detail->>'player' = $1::bigint::text)
               OR (l.action = ANY($4) AND l.detail->>'author' = $1::bigint::text))
          AND l.id < $5
        ORDER BY l.id DESC
        LIMIT $6
        "#,
        player.get(),
        &player_actions()[..],
        &run_actions.map(str::to_owned)[..],
        &post_actions.map(str::to_owned)[..],
        before,
        PAGE_SIZE + 1
    )
    .fetch_all(db)
    .await?;
    LogEntries::page(rows)
}

/// The entries about one map, newest first: actions whose target is the map's name.
pub(super) async fn map_entries(
    db: &sqlx::PgPool,
    map: &crate::maps::MapName,
    before: i64,
) -> Result<LogEntries, ApiError> {
    let map_actions = [
        StaffAction::SetTier,
        StaffAction::SetMapImage,
        StaffAction::AddMapImage,
        StaffAction::RemoveMapImage,
        StaffAction::OrderMapImages,
        StaffAction::SetBannerFocus,
        StaffAction::SetMapDescription,
        StaffAction::SetMapRelease,
        StaffAction::PublishZones,
        StaffAction::UploadViewerFile,
    ]
    .map(|action| action.name().to_owned());
    let rows = sqlx::query_as!(
        LogRow,
        r#"
        SELECT l.id, l.action, l.target, l.reason, l.detail, l.at,
               a.steamid64::text AS "actor_steamid64?", a.name AS "actor_name?",
               a.avatar_url AS actor_avatar_url, a.country_code AS actor_country_code,
               NULL::text AS "target_steamid64?", NULL::text AS "target_name?",
               NULL::text AS target_avatar_url, NULL::text AS target_country_code
        FROM staff_log l
        LEFT JOIN players a ON a.steamid64 = l.actor_steamid64
        WHERE l.action = ANY($2) AND l.target = $1 AND l.id < $3
        ORDER BY l.id DESC
        LIMIT $4
        "#,
        map.as_str(),
        &map_actions[..],
        before,
        PAGE_SIZE + 1
    )
    .fetch_all(db)
    .await?;
    LogEntries::page(rows)
}

/// A player from a LEFT JOIN, which has one only when the row matched.
pub(super) fn player_ref(
    steamid64: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
    country_code: Option<String>,
) -> Option<PlayerRef> {
    Some(PlayerRef {
        steamid64: steamid64?,
        name: name?,
        avatar_url,
        country_code,
    })
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        auth::sessions,
        players::privileges::{self, Privilege, Privileges},
        test_client,
    };

    const STAFF: &str = "76561197960287930";

    async fn staff_session(db: &PgPool) -> String {
        let steamid64 = SteamId64::parse_any(STAFF).unwrap();
        privileges::grant(db, steamid64, Privileges::of(&[Privilege::ManageMaps]))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn read(db: &PgPool, token: &str, query: &str) -> test_client::TestResponse {
        let request = Request::get(format!("/v1/staff/log{query}"))
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(Body::empty())
            .unwrap();
        test_client::send(db, request).await
    }

    async fn log(db: &PgPool, actor: Option<SteamId64>, target: &str) {
        let mut tx = db.begin().await.unwrap();
        record(
            &mut tx,
            Entry {
                actor,
                action: StaffAction::GrantPrivileges,
                target,
                reason: None,
                detail: json!({ "privileges": ["manage_bans"] }),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
    }

    #[test]
    fn action_names_match_the_api() {
        for action in StaffAction::ALL {
            assert_eq!(serde_json::to_value(action).unwrap(), action.name());
            assert_eq!(StaffAction::from_name(action.name()), Some(action));
        }
    }

    #[sqlx::test]
    async fn staff_read_the_log_newest_first_in_pages(db: PgPool) {
        let token = staff_session(&db).await;
        let actor = SteamId64::parse_any(STAFF);
        for n in 0..PAGE_SIZE + 2 {
            log(&db, actor, &format!("target {n}")).await;
        }
        log(&db, None, "from the command line").await;

        let first: StaffLog = read(&db, &token, "").await.json();
        assert_eq!(first.entries.len(), 50);
        assert_eq!(first.entries[0].target, "from the command line");
        assert!(first.entries[0].actor.is_none());
        assert_eq!(first.entries[1].actor.as_ref().unwrap().steamid64, STAFF);
        // The targets aren't players SourceJump knows, so there's nobody to show.
        assert!(first.entries[1].target_player.is_none());
        assert_eq!(first.newer, None);

        let older = first.older.clone().unwrap();
        let rest: StaffLog = read(&db, &token, &format!("?before={older}")).await.json();
        let targets: Vec<&str> = rest.entries.iter().map(|e| e.target.as_str()).collect();
        assert_eq!(targets, ["target 2", "target 1", "target 0"]);
        assert_eq!(rest.older, None);

        // Newer from the last page is the 50 entries right after it, newest first.
        let newer = rest.newer.unwrap();
        let back: StaffLog = read(&db, &token, &format!("?after={newer}")).await.json();
        assert_eq!(back.entries.len(), 50);
        assert_eq!(back.entries[0].target, "from the command line");
        assert_eq!(back.entries[49].target, "target 3");
        assert_eq!((back.older, back.newer), (first.older, None));
    }

    #[sqlx::test]
    async fn a_maps_entries_come_50_at_a_time(db: PgPool) {
        let map = crate::maps::MapName::try_from("bhop_paged".to_owned()).unwrap();
        for tier in 0..52 {
            let mut tx = db.begin().await.unwrap();
            record(
                &mut tx,
                Entry {
                    actor: None,
                    action: StaffAction::SetTier,
                    target: map.as_str(),
                    reason: None,
                    detail: json!({ "track": 0, "tier": tier }),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }
        let Ok(first) = map_entries(&db, &map, i64::MAX).await else {
            panic!("read the first page")
        };
        assert_eq!(first.entries.len(), 50);
        assert_eq!(first.entries[0].detail["tier"], 51);
        let older: i64 = first.older.unwrap().parse().unwrap();
        let Ok(rest) = map_entries(&db, &map, older).await else {
            panic!("read the older page")
        };
        let tiers: Vec<_> = rest
            .entries
            .iter()
            .map(|e| e.detail["tier"].clone())
            .collect();
        assert_eq!(tiers, [json!(1), json!(0)]);
        assert_eq!(rest.older, None);
    }

    #[sqlx::test]
    async fn a_page_takes_one_cursor(db: PgPool) {
        let token = staff_session(&db).await;
        assert_eq!(read(&db, &token, "?before=5&after=1").await.status, 422);
        assert_eq!(read(&db, &token, "?before=soon").await.status, 422);
    }

    #[sqlx::test]
    async fn actions_on_a_player_name_them(db: PgPool) {
        let token = staff_session(&db).await;
        log(&db, None, STAFF).await;
        let page: StaffLog = read(&db, &token, "").await.json();
        assert_eq!(
            page.entries[0].target_player.as_ref().unwrap().steamid64,
            STAFF
        );
    }

    #[sqlx::test]
    async fn the_log_reads_by_kind_and_by_what_its_about(db: PgPool) {
        let token = staff_session(&db).await;
        let actor = SteamId64::parse_any(STAFF);
        let other = "76561197960287931";
        let entries = [
            (StaffAction::GrantPrivileges, other, json!({})),
            (
                StaffAction::SetTier,
                "bhop_badges",
                json!({ "track": 0, "tier": 2 }),
            ),
            (
                StaffAction::IssueKey,
                "sj_12345678",
                json!({ "server_id": 7, "server": "Kawaii EU" }),
            ),
            (StaffAction::ListServer, "198.51.100.1:27015", json!({})),
            (StaffAction::InvalidateRun, "42", json!({ "player": other })),
        ];
        for (action, target, detail) in entries {
            let mut tx = db.begin().await.unwrap();
            let entry = Entry {
                actor,
                action,
                target,
                reason: None,
                detail,
            };
            record(&mut tx, entry).await.unwrap();
            tx.commit().await.unwrap();
        }
        let targets = |page: StaffLog| -> Vec<String> {
            page.entries.into_iter().map(|e| e.target).collect()
        };

        let maps: StaffLog = read(&db, &token, "?kind=maps").await.json();
        assert_eq!(targets(maps), ["bhop_badges"]);
        // A player in any SteamID form: what was done to them and to their runs.
        let player: StaffLog = read(&db, &token, "?about=%5BU%3A1%3A22203%5D").await.json();
        assert_eq!(targets(player), ["42", other]);
        // What a staff member did.
        let by_staff: StaffLog = read(&db, &token, &format!("?about={STAFF}&kind=servers"))
            .await
            .json();
        assert_eq!(targets(by_staff), ["198.51.100.1:27015", "sj_12345678"]);
        // A server by its ID or name; a key or address by itself.
        let server: StaffLog = read(&db, &token, "?about=kawaii%20eu").await.json();
        assert_eq!(targets(server), ["sj_12345678"]);
        let server: StaffLog = read(&db, &token, "?about=7").await.json();
        assert_eq!(targets(server), ["sj_12345678"]);
        let address: StaffLog = read(&db, &token, "?about=198.51.100.1:27015").await.json();
        assert_eq!(
            (address.entries.len(), address.older, address.newer),
            (1, None, None)
        );
    }

    #[sqlx::test]
    async fn the_log_cant_be_changed(db: PgPool) {
        log(&db, None, "kept").await;
        let changed = sqlx::query!("UPDATE staff_log SET target = 'gone'")
            .execute(&db)
            .await;
        assert!(changed.is_err());
        assert!(
            sqlx::query!("DELETE FROM staff_log")
                .execute(&db)
                .await
                .is_err()
        );
    }

    #[sqlx::test]
    async fn players_who_arent_staff_cant_read_it(db: PgPool) {
        let steamid64 = SteamId64::parse_any("76561197960287931").unwrap();
        privileges::grant(&db, steamid64, Privileges::of(&[Privilege::PostCommunity]))
            .await
            .unwrap();
        let token = sessions::create(&db, steamid64).await.unwrap();
        assert_eq!(read(&db, &token, "").await.status, 403);
    }
}
