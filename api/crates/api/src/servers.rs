//! Game servers: their API keys, the heartbeat each server sends on map start and every few minutes, and
//! the list of servers the site shows.

mod activity;
pub mod heartbeat;
pub mod heartbeat_limit;
pub mod keys;
pub mod list;
pub mod listing;

use chrono::{DateTime, TimeDelta, Utc};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

pub fn routes() -> OpenApiRouter<AppState> {
    heartbeat::routes()
        .routes(routes!(list::list_servers))
        .routes(routes!(activity::server_activity))
}

/// How far a server's clock may be off from ours. A time further ahead is wrong or made up, and would win every
/// "newest" comparison: a player's name, Activity order, a map's last run. A run's time further behind its ruleset
/// or server would win ties and rewrite WR history (`runs::check_ruleset`).
pub const CLOCK_SLACK: TimeDelta = TimeDelta::minutes(5);

/// Reads a time a game server reports (`finished_at`, `detected_at`), in Unix seconds by its clock.
pub fn server_time(field: &str, unix: i64, now: DateTime<Utc>) -> Result<DateTime<Utc>, String> {
    let at = DateTime::from_timestamp(unix, 0)
        .ok_or_else(|| format!("{field} is not a valid Unix time"))?;
    if at > now + CLOCK_SLACK {
        return Err(format!(
            "{field} is in the future; check the server's clock"
        ));
    }
    Ok(at)
}
