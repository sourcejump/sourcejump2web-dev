//! One feed's posts: reading the records, laying each out as an embed like the old site's, and sending them
//! to the webhook, several to a message.

use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;

use super::{Feed, FeedError, Links, Records};
use crate::{
    maps::{image, tiers::tier_count},
    record_events::RecordEvent,
};

/// The site's accent colour, so the posts read as SourceJump's.
const ACCENT: u32 = 0x00_c8_f0;
/// Discord takes at most 10 embeds in a message, and 6000 characters across them.
const EMBEDS_PER_MESSAGE: usize = 10;
/// Kept well under Discord's 6000, since this counts a little differently (`text_length`).
const TEXT_PER_MESSAGE: usize = 5000;
/// The highest tier with an icon in `web/public/tiers/`.
const HIGHEST_TIER_ICON: i16 = 10;

/// A record as a post shows it.
#[derive(Debug)]
struct Record {
    run_id: i64,
    map: String,
    style_name: String,
    track: i16,
    tier: Option<i16>,
    steamid64: String,
    player: String,
    time: f64,
    /// The board's best before this run, for a world record; the player's own, for a personal best.
    previous_time: Option<f64>,
    /// The run's place on its board when the feed read it.
    rank: Option<i64>,
    /// A world record when set: faster than every earlier run on its board (`leaderboards/world_records.rs`).
    /// A tie isn't.
    fastest_yet: bool,
    sync: f32,
    strafes: i32,
    jumps: i32,
    finished_at: DateTime<Utc>,
    server_name: String,
    /// Only for addresses staff listed, as the run's page shows it.
    server_address: Option<String>,
    image_key: Option<String>,
}

/// Posts these events' records that the feed takes and hasn't posted yet, in event order.
pub(super) async fn post(
    conn: &mut PgConnection,
    http: &reqwest::Client,
    feed: &Feed,
    links: &Links,
    events: &[&RecordEvent],
) -> Result<(), FeedError> {
    // The same run can be reported more than once in a page, by a restore, and not always next to itself.
    let mut run_ids: Vec<i64> = Vec::with_capacity(events.len());
    for event in events {
        if !run_ids.contains(&event.run_id) {
            run_ids.push(event.run_id);
        }
    }
    let posted = sqlx::query_scalar!(
        "SELECT run_id FROM discord_feed_posts WHERE feed = $1 AND run_id = ANY($2)",
        feed.name,
        &run_ids
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut records = records(conn, feed.records, &run_ids).await?;
    // Rank 1 alone would take a run that ties the record, which the site doesn't count as one.
    records.retain(|r| {
        !posted.contains(&r.run_id)
            && feed.takes_tier(r.tier)
            && (feed.records == Records::PersonalBests || r.fastest_yet)
    });
    for record in &mut records {
        record.rank = events
            .iter()
            .find(|e| e.run_id == record.run_id)
            .and_then(|e| e.rank);
    }

    let embeds: Vec<(i64, Value)> = records
        .iter()
        .map(|record| (record.run_id, embed(record, feed.records, links)))
        .collect();
    for message in messages(&embeds) {
        let (ids, embeds): (Vec<i64>, Vec<Value>) = message.iter().cloned().unzip();
        send(
            http,
            feed,
            &json!({ "embeds": embeds, "allowed_mentions": { "parse": [] } }),
        )
        .await?;
        sqlx::query!(
            "INSERT INTO discord_feed_posts (run_id, feed) SELECT unnest($1::bigint[]), $2
             ON CONFLICT DO NOTHING",
            &ids,
            feed.name
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// The records of these runs, in the order given.
async fn records(
    conn: &mut PgConnection,
    records: Records,
    run_ids: &[i64],
) -> Result<Vec<Record>, sqlx::Error> {
    let tiers_published = tier_count(&mut *conn).await?.is_some();
    let rows = sqlx::query!(
        r#"
        SELECT r.id, m.name AS map, r.style, r.track, r.time, r.sync, r.strafes, r.jumps, r.finished_at, r.was_record,
               r.player_steamid64::text AS "steamid64!", p.name AS player, s.name AS server_name,
               (SELECT st->>'name' FROM rulesets, jsonb_array_elements(document->'styles') st
                WHERE st->>'key' = r.style ORDER BY version DESC LIMIT 1) AS style_name,
               (SELECT min(o.time) FROM runs o
                WHERE o.map_id = r.map_id AND o.style = r.style AND o.track = r.track
                  AND o.invalidated_at IS NULL AND (o.finished_at, o.id) < (r.finished_at, r.id))
                 AS previous_record,
               (SELECT min(o.time) FROM runs o
                WHERE o.map_id = r.map_id AND o.style = r.style AND o.track = r.track
                  AND o.player_steamid64 = r.player_steamid64
                  AND o.invalidated_at IS NULL AND (o.finished_at, o.id) < (r.finished_at, r.id))
                 AS previous_personal_best,
               (SELECT tier FROM current_map_tiers WHERE map_id = r.map_id AND track = r.track) AS tier,
               (SELECT key FROM map_images WHERE map_id = r.map_id AND position = 0) AS image_key,
               (SELECT host(h.ip) || ':' || h.port FROM server_heartbeats h
                JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
                WHERE h.server_id = s.id ORDER BY h.received_at DESC LIMIT 1) AS server_address
        FROM unnest($1::bigint[]) WITH ORDINALITY AS wanted (run_id, place)
        JOIN runs r ON r.id = wanted.run_id
        JOIN maps m ON m.id = r.map_id
        JOIN players p ON p.steamid64 = r.player_steamid64
        JOIN servers s ON s.id = r.server_id
        ORDER BY wanted.place
        "#,
        run_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Record {
            run_id: row.id,
            map: row.map,
            style_name: row.style_name.unwrap_or(row.style),
            track: row.track,
            tier: row.tier.filter(|_| tiers_published),
            steamid64: row.steamid64,
            player: row.player,
            time: row.time,
            previous_time: match records {
                Records::WorldRecords => row.previous_record,
                Records::PersonalBests => row.previous_personal_best,
            },
            rank: None,
            fastest_yet: row.was_record,
            sync: row.sync,
            strafes: row.strafes,
            jumps: row.jumps,
            finished_at: row.finished_at,
            server_name: row.server_name,
            server_address: row.server_address,
            image_key: row.image_key,
        })
        .collect())
}

/// One record's embed: the map with its tier icon on top, then the run.
fn embed(record: &Record, records: Records, links: &Links) -> Value {
    let page = |path: &str| {
        links
            .public_url
            .join(path)
            .map(String::from)
            .unwrap_or_default()
    };
    let time = match record.previous_time {
        Some(previous) => format!(
            "{} (-{})",
            format_time(record.time),
            format_time(previous - record.time)
        ),
        None => format_time(record.time),
    };
    let server = match &record.server_address {
        Some(address) => format!(
            "{}\nJoin: steam://connect/{address}",
            escape(&record.server_name)
        ),
        None => escape(&record.server_name),
    };
    let map = if record.track == 0 {
        record.map.clone()
    } else {
        format!("{} · Bonus {}", record.map, record.track)
    };
    let kind = match records {
        Records::WorldRecords => "World Record",
        Records::PersonalBests => "Personal Best",
    };

    let mut fields = vec![
        json!({
            "name": "Player",
            "value": format!("[{}]({})", escape(&record.player), page(&format!("players/{}", record.steamid64))),
            "inline": true,
        }),
        json!({ "name": "Time", "value": time, "inline": true }),
    ];
    if let (Records::PersonalBests, Some(rank)) = (records, record.rank) {
        fields.push(json!({ "name": "Rank", "value": format!("#{rank}"), "inline": true }));
    }
    fields.push(json!({
        "name": "Additional",
        "value": format!(
            "**Sync:** {:.2}% **Strafes:** {} **Jumps:** {}\n**Run ID:** [{}]({})",
            record.sync, record.strafes, record.jumps, record.run_id,
            page(&format!("runs/{}", record.run_id)),
        ),
    }));
    fields.push(json!({ "name": "Server", "value": server }));

    let mut embed = json!({
        "author": { "name": map, "url": page(&format!("maps/{}", record.map)) },
        "color": ACCENT,
        "fields": fields,
        "footer": { "text": format!("{kind} · {}", record.style_name) },
        "timestamp": record.finished_at.to_rfc3339_opts(SecondsFormat::Secs, true),
    });
    if let Some(tier) = record
        .tier
        .filter(|tier| (0..=HIGHEST_TIER_ICON).contains(tier))
    {
        embed["author"]["icon_url"] = json!(page(&format!("tiers/t{tier}.png")));
    }
    if let Some(key) = &record.image_key {
        embed["thumbnail"] =
            json!({ "url": links.storage.public_url(&image::file_key(key, image::SMALL)) });
    }
    embed
}

/// Groups embeds into as few messages as Discord's limits allow, keeping their order.
fn messages(embeds: &[(i64, Value)]) -> Vec<&[(i64, Value)]> {
    let mut messages = Vec::new();
    let (mut start, mut text) = (0, 0);
    for (i, (_, embed)) in embeds.iter().enumerate() {
        let length = text_length(embed);
        if i > start && (i - start == EMBEDS_PER_MESSAGE || text + length > TEXT_PER_MESSAGE) {
            messages.push(&embeds[start..i]);
            (start, text) = (i, 0);
        }
        text += length;
    }
    if start < embeds.len() {
        messages.push(&embeds[start..]);
    }
    messages
}

/// Every string in an embed, links included, so it counts more than Discord does and stays safe.
fn text_length(value: &Value) -> usize {
    match value {
        Value::String(text) => text.chars().count(),
        Value::Array(items) => items.iter().map(text_length).sum(),
        Value::Object(fields) => fields.values().map(text_length).sum(),
        _ => 0,
    }
}

/// Sends a message to a feed's webhook, waiting out Discord's rate limit when it asks.
async fn send(http: &reqwest::Client, feed: &Feed, message: &Value) -> Result<(), FeedError> {
    let body = serde_json::to_vec(message).expect("a JSON value serializes");
    for _ in 0..5 {
        let response = http
            .post(&feed.webhook)
            .header("content-type", "application/json")
            .body(body.clone())
            .send()
            .await
            // Without the URL: reqwest's errors include it, and it's a secret.
            .map_err(|error| FeedError::Unavailable(error.without_url().to_string()))?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let answer = response.text().await.unwrap_or_default();
            let retry_after = serde_json::from_str::<RateLimited>(&answer)
                .map_or(1.0, |limited| limited.retry_after);
            tokio::time::sleep(Duration::from_secs_f64(retry_after.clamp(0.0, 60.0))).await;
            continue;
        }
        if status.is_server_error() {
            return Err(FeedError::Unavailable(format!(
                "feed {:?} answered {status}",
                feed.name
            )));
        }
        // Retrying won't change a refusal, so these records are skipped for this feed.
        let answer = response.text().await.unwrap_or_default();
        tracing::error!(feed = %feed.name, %status, %answer, "Discord refused a record post; skipped");
        return Ok(());
    }
    Err(FeedError::Unavailable(format!(
        "feed {:?} still rate limited",
        feed.name
    )))
}

#[derive(Deserialize)]
struct RateLimited {
    retry_after: f64,
}

/// A time as the site shows it: `52.594`, `1:02.345`, `1:02:03.456`.
fn format_time(seconds: f64) -> String {
    // Times are positive and far below what an i64 of milliseconds holds.
    #[allow(clippy::cast_possible_truncation)]
    let total_ms = (seconds * 1000.0).round() as i64;
    let (ms, total_seconds) = (total_ms % 1000, total_ms / 1000);
    let (s, m, h) = (
        total_seconds % 60,
        total_seconds / 60 % 60,
        total_seconds / 3600,
    );
    if h > 0 {
        format!("{h}:{m:02}:{s:02}.{ms:03}")
    } else if m > 0 {
        format!("{m}:{s:02}.{ms:03}")
    } else {
        format!("{s}.{ms:03}")
    }
}

/// Player and server names are typed by players, so Discord markdown in them is shown as written.
fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(
            c,
            '\\' | '*'
                | '_'
                | '~'
                | '`'
                | '|'
                | '>'
                | '['
                | ']'
                | '('
                | ')'
                | '#'
                | '-'
                | '@'
                | '<'
                | ':'
        ) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{EMBEDS_PER_MESSAGE, escape, format_time, messages};

    #[test]
    fn times_and_names_read_as_on_the_site() {
        assert_eq!(format_time(52.594), "52.594");
        assert_eq!(format_time(0.225), "0.225");
        assert_eq!(format_time(62.345), "1:02.345");
        assert_eq!(format_time(3723.456), "1:02:03.456");
        assert_eq!(escape("*plar*_[x](y)"), r"\*plar\*\_\[x\]\(y\)");
    }

    #[test]
    fn embeds_are_grouped_under_discords_limits() {
        let small: Vec<_> = (0..23).map(|i| (i, json!({ "a": "x" }))).collect();
        let sizes: Vec<_> = messages(&small).iter().map(|m| m.len()).collect();
        assert_eq!(sizes, [EMBEDS_PER_MESSAGE, EMBEDS_PER_MESSAGE, 3]);

        let big: Vec<_> = (0..3)
            .map(|i| (i, json!({ "a": "x".repeat(2000) })))
            .collect();
        let sizes: Vec<_> = messages(&big).iter().map(|m| m.len()).collect();
        assert_eq!(sizes, [2, 1]);
    }
}
