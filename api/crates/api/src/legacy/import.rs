//! `legacy import <dump folder>`: reads the old site's `sj_maps.sql`, `sj_players.sql` and `sj_times.sql`,
//! replaces the `legacy_*` tables with them, and carries the old ban list over.
//!
//! Choices from the lead (2026-10-26): every run is kept, not just personal bests; runs the old site marked
//! invalid are dropped; server IPs aren't kept; each old ban becomes a 2.0 ban from everything, until lifted.
//! Staff privileges don't carry over; the lead grants them again on the site.
//!
//! Everything is one transaction, so a failed import changes nothing. Running it again with a newer dump
//! replaces the legacy tables and adds only the bans not carried over before, which is how the final dump at
//! the switch is read.

use std::{collections::BTreeMap, collections::HashMap, error::Error, path::Path, str::FromStr};

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde_json::json;
use sqlx::{PgConnection, PgPool};

use super::dump::{self, Table, Value};
use crate::{
    maps::MapName,
    players::{
        SteamId64, countries,
        restrictions::{Restriction, Restrictions},
    },
    staff::{
        log::{self, StaffAction},
        runs::{RunsOf, invalidate_runs_of},
    },
};

/// Rows written per statement; large enough to be quick, small enough to keep each statement's arrays modest.
const BATCH: usize = 10_000;
/// The longest ban reason a 2.0 ban takes (`bans.reason`).
const MAX_REASON_CHARS: usize = 500;

/// What an import did, and what it left out and why.
#[derive(Debug, Default)]
pub struct Report {
    pub maps: usize,
    pub players: usize,
    pub runs: usize,
    pub bans: usize,
    /// Reason → how many rows it left out.
    pub skipped: BTreeMap<&'static str, usize>,
}

impl Report {
    fn skip(&mut self, reason: &'static str) {
        *self.skipped.entry(reason).or_default() += 1;
    }
}

/// Reads the dump in `folder` and imports it.
pub async fn import(db: &PgPool, folder: &Path) -> Result<Report, Box<dyn Error>> {
    let read = |file: &str, table: &str| -> Result<Table, Box<dyn Error>> {
        let path = folder.join(file);
        let text = std::fs::read_to_string(&path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        dump::read_table(&text, table)
            .map_err(|error| format!("{}: {error}", path.display()).into())
    };
    let mut report = Report::default();
    let maps = read_maps(&read("sj_maps.sql", "maps")?, &mut report)?;
    let players = read_players(&read("sj_players.sql", "players")?, &mut report)?;
    let runs = read_runs(
        &read("sj_times.sql", "times")?,
        &maps,
        &players,
        &mut report,
    )?;
    let maps = without_missing_records(maps, &runs);

    let mut tx = db.begin().await?;
    // Standings and runs first: they reference the other two.
    sqlx::query!("DELETE FROM legacy_standings")
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM legacy_runs")
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM legacy_players")
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM legacy_maps")
        .execute(&mut *tx)
        .await?;
    write_maps(&mut tx, &maps).await?;
    write_players(&mut tx, players.values()).await?;
    write_runs(&mut tx, &runs).await?;
    // Completions on the pre-2.0 leaderboards are counted out of the maps with a run (`leaderboards.rs`).
    sqlx::query!(
        "UPDATE legacy_maps m SET has_runs = EXISTS (SELECT 1 FROM legacy_runs r WHERE r.map_id = m.id)"
    )
    .execute(&mut *tx)
    .await?;
    for player in players.values() {
        if let Some(ban) = &player.ban {
            if carry_ban_over(&mut tx, player, ban).await? {
                report.bans += 1;
            } else {
                report.skip("ban already carried over");
            }
        }
    }
    crate::leaderboards::standings::refresh_legacy(&mut tx).await?;
    crate::daily_totals::rebuild(&mut tx).await?;
    tx.commit().await?;

    report.maps = maps.len();
    report.players = players.len();
    report.runs = runs.len();
    Ok(report)
}

struct LegacyMap {
    id: i32,
    name: String,
    tier: Option<i16>,
    points: i32,
    wr_run_id: Option<i32>,
    old_wr_run_id: Option<i32>,
}

struct LegacyPlayer {
    steamid64: SteamId64,
    name: String,
    alias: Option<String>,
    avatar_url: Option<String>,
    country_code: Option<&'static str>,
    /// In the order of `legacy_players`' setup columns.
    setup: [Option<String>; 7],
    ban: Option<LegacyBan>,
}

struct LegacyBan {
    reason: String,
    banned_at: Option<DateTime<Utc>>,
}

struct LegacyRun {
    id: i32,
    map_id: i32,
    player: SteamId64,
    player_name: String,
    server_hostname: String,
    time: f64,
    sync: f32,
    strafes: i32,
    jumps: i32,
    finished_at: Option<DateTime<Utc>>,
    initial_record: bool,
    video: Option<String>,
}

/// A table's columns by name, read as the type the importer wants.
struct Columns {
    /// The dump's table name, for errors.
    table: &'static str,
    names: Vec<(&'static str, usize)>,
}

impl Columns {
    fn new(
        name: &'static str,
        table: &Table,
        columns: &[&'static str],
    ) -> Result<Self, dump::DumpError> {
        let names = columns
            .iter()
            .map(|&column| table.column(column).map(|index| (column, index)))
            .collect::<Result<_, _>>()?;
        Ok(Self { table: name, names })
    }

    fn index(&self, name: &str) -> usize {
        self.names
            .iter()
            .find(|(known, _)| *known == name)
            .map(|(_, index)| *index)
            .expect("columns are named in `new` before they're read")
    }

    /// The text of a value, with surrounding whitespace dropped; None for NULL or blank.
    fn text(&self, row: &[Value], name: &str) -> Option<String> {
        match &row[self.index(name)] {
            Value::Null => None,
            Value::Number(text) | Value::Text(text) => {
                Some(text.trim().to_owned()).filter(|text| !text.is_empty())
            }
        }
    }

    /// A number, or an error naming the table and column when it isn't one.
    fn number<T: FromStr>(&self, row: &[Value], name: &str) -> Result<Option<T>, String> {
        self.text(row, name)
            .map(|text| {
                text.parse()
                    .map_err(|_| format!("{name} {text:?} in `{}` isn't a number", self.table))
            })
            .transpose()
    }
}

fn read_maps(table: &Table, report: &mut Report) -> Result<Vec<LegacyMap>, Box<dyn Error>> {
    let c = Columns::new(
        "maps",
        table,
        &["id", "map", "tier", "wr_id", "old_wr_id", "points"],
    )?;
    let mut maps = Vec::new();
    for row in &table.rows {
        // A handful of names the old site took have spaces, brackets or symbols; their few runs go with them.
        let Some(name) = c
            .text(row, "map")
            .and_then(|name| MapName::try_from(name).ok())
        else {
            report.skip("map name isn't one a map can have");
            continue;
        };
        maps.push(LegacyMap {
            id: c.number(row, "id")?.ok_or("a map has no id")?,
            name: name.as_str().to_owned(),
            tier: c.number(row, "tier")?.filter(|&tier: &i16| tier > 0),
            points: c.number(row, "points")?.unwrap_or(0),
            wr_run_id: c.number(row, "wr_id")?,
            old_wr_run_id: c.number(row, "old_wr_id")?,
        });
    }
    Ok(maps)
}

fn read_players(
    table: &Table,
    report: &mut Report,
) -> Result<HashMap<SteamId64, LegacyPlayer>, Box<dyn Error>> {
    const SETUP: [&str; 7] = [
        "setup_mouse",
        "setup_mouse_pad",
        "setup_dpi",
        "setup_sens",
        "setup_monitor",
        "setup_aspect",
        "setup_keyboard",
    ];
    let mut names = vec![
        "steamid",
        "name",
        "alias",
        "avatar",
        "country",
        "banned",
        "ban_reason",
        "ban_date",
    ];
    names.extend(SETUP);
    let c = Columns::new("players", table, &names)?;
    let mut players = HashMap::new();
    for row in &table.rows {
        // Some rows hold another kind of Steam account ([I:…], [G:…], …); none of them has a run.
        let Some(steamid64) = c
            .text(row, "steamid")
            .and_then(|id| SteamId64::parse_any(&id))
        else {
            report.skip("player isn't an individual Steam account");
            continue;
        };
        if players.contains_key(&steamid64) {
            report.skip("player listed twice under another form of their SteamID");
            continue;
        }
        let ban = (c.number::<u8>(row, "banned")? == Some(1)).then(|| LegacyBan {
            reason: ban_reason(c.text(row, "ban_reason")),
            banned_at: c.text(row, "ban_date").as_deref().and_then(parse_date),
        });
        players.insert(
            steamid64,
            LegacyPlayer {
                steamid64,
                name: c.text(row, "name").unwrap_or_else(|| steamid64.to_string()),
                alias: c.text(row, "alias"),
                avatar_url: c
                    .text(row, "avatar")
                    .filter(|url| url.starts_with("https://")),
                country_code: c.text(row, "country").as_deref().and_then(country_code),
                setup: SETUP.map(|name| c.text(row, name)),
                ban,
            },
        );
    }
    Ok(players)
}

fn read_runs(
    table: &Table,
    maps: &[LegacyMap],
    players: &HashMap<SteamId64, LegacyPlayer>,
    report: &mut Report,
) -> Result<Vec<LegacyRun>, Box<dyn Error>> {
    let c = Columns::new(
        "times",
        table,
        &[
            "id",
            "hostname",
            "map",
            "name",
            "steamid",
            "time",
            "sync",
            "strafes",
            "jumps",
            "date",
            "invalid",
            "initial_record",
            "video",
        ],
    )?;
    let map_ids: HashMap<&str, i32> = maps.iter().map(|map| (map.name.as_str(), map.id)).collect();
    let mut runs = Vec::new();
    for row in &table.rows {
        if c.text(row, "invalid").is_some() {
            report.skip("run the old site marked invalid");
            continue;
        }
        let Some(&map_id) = c.text(row, "map").and_then(|map| map_ids.get(map.as_str())) else {
            report.skip("run on a map that wasn't imported");
            continue;
        };
        let Some(player) = c
            .text(row, "steamid")
            .and_then(|id| SteamId64::parse_any(&id))
            .filter(|id| players.contains_key(id))
        else {
            report.skip("run by a player who wasn't imported");
            continue;
        };
        let Some(time) = c.number::<f64>(row, "time")?.filter(|&time| time > 0.0) else {
            report.skip("run without a time");
            continue;
        };
        runs.push(LegacyRun {
            id: c.number(row, "id")?.ok_or("a run has no id")?,
            map_id,
            player,
            player_name: c.text(row, "name").unwrap_or_else(|| player.to_string()),
            server_hostname: c.text(row, "hostname").unwrap_or_default(),
            time,
            sync: c.number(row, "sync")?.unwrap_or(0.0),
            strafes: c.number(row, "strafes")?.unwrap_or(0),
            jumps: c.number(row, "jumps")?.unwrap_or(0),
            finished_at: c.text(row, "date").as_deref().and_then(parse_date),
            initial_record: c.number::<u8>(row, "initial_record")? == Some(1),
            video: c.text(row, "video"),
        });
    }
    Ok(runs)
}

/// Clears record links to runs that weren't imported, such as one the old site later marked invalid, and to
/// runs on another map, which a few of the old site's links point at.
fn without_missing_records(mut maps: Vec<LegacyMap>, runs: &[LegacyRun]) -> Vec<LegacyMap> {
    let map_of: HashMap<i32, i32> = runs.iter().map(|run| (run.id, run.map_id)).collect();
    for map in &mut maps {
        let on_this_map = |id: &i32| map_of.get(id) == Some(&map.id);
        map.wr_run_id = map.wr_run_id.filter(on_this_map);
        map.old_wr_run_id = map.old_wr_run_id.filter(on_this_map);
    }
    maps
}

/// The old site's dates are text, nearly all `YYYY-MM-DD HH:MM:SS` in UTC. A few are a bare date, a Unix
/// timestamp or a typo; the first two still read, the rest are left without a date.
fn parse_date(text: &str) -> Option<DateTime<Utc>> {
    let text = text.trim();
    if !text.is_empty() && text.chars().all(|c| c.is_ascii_digit()) {
        return DateTime::from_timestamp(text.parse().ok()?, 0);
    }
    ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"]
        .iter()
        .find_map(|format| NaiveDateTime::parse_from_str(text, format).ok())
        .or_else(|| {
            NaiveDate::parse_from_str(text, "%Y-%m-%d")
                .ok()?
                .and_hms_opt(0, 0, 0)
        })
        .map(|date| date.and_utc())
}

/// The old site stored lowercase codes and wrote the United Kingdom as `uk`, which isn't ISO's code for it.
fn country_code(code: &str) -> Option<&'static str> {
    if code.eq_ignore_ascii_case("uk") {
        Some("GB")
    } else {
        countries::known_code(code)
    }
}

fn ban_reason(reason: Option<String>) -> String {
    let reason = reason.unwrap_or_else(|| "Banned on the old site".to_owned());
    reason.chars().take(MAX_REASON_CHARS).collect()
}

async fn write_maps(conn: &mut PgConnection, maps: &[LegacyMap]) -> Result<(), sqlx::Error> {
    for batch in maps.chunks(BATCH) {
        let ids: Vec<i32> = batch.iter().map(|map| map.id).collect();
        let names: Vec<String> = batch.iter().map(|map| map.name.clone()).collect();
        let tiers: Vec<Option<i16>> = batch.iter().map(|map| map.tier).collect();
        let points: Vec<i32> = batch.iter().map(|map| map.points).collect();
        let records: Vec<Option<i32>> = batch.iter().map(|map| map.wr_run_id).collect();
        let old_records: Vec<Option<i32>> = batch.iter().map(|map| map.old_wr_run_id).collect();
        sqlx::query!(
            "INSERT INTO legacy_maps (id, name, tier, points, wr_run_id, old_wr_run_id)
             SELECT * FROM unnest($1::int[], $2::text[], $3::smallint[], $4::int[], $5::int[], $6::int[])",
            &ids,
            &names,
            &tiers as &[Option<i16>],
            &points,
            &records as &[Option<i32>],
            &old_records as &[Option<i32>],
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn write_players(
    conn: &mut PgConnection,
    players: impl Iterator<Item = &LegacyPlayer>,
) -> Result<(), sqlx::Error> {
    let players: Vec<&LegacyPlayer> = players.collect();
    for batch in players.chunks(BATCH) {
        let column = |pick: fn(&LegacyPlayer) -> Option<String>| -> Vec<Option<String>> {
            batch.iter().map(|player| pick(player)).collect()
        };
        let setup = |index: usize| -> Vec<Option<String>> {
            batch
                .iter()
                .map(|player| player.setup[index].clone())
                .collect()
        };
        let ids: Vec<i64> = batch.iter().map(|player| player.steamid64.get()).collect();
        let names: Vec<String> = batch.iter().map(|player| player.name.clone()).collect();
        sqlx::query!(
            "INSERT INTO legacy_players (steamid64, name, alias, avatar_url, country_code, setup_mouse,
                 setup_mouse_pad, setup_dpi, setup_sens, setup_monitor, setup_aspect, setup_keyboard)
             SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                 $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[])",
            &ids,
            &names,
            &column(|player| player.alias.clone()) as &[Option<String>],
            &column(|player| player.avatar_url.clone()) as &[Option<String>],
            &column(|player| player.country_code.map(str::to_owned)) as &[Option<String>],
            &setup(0) as &[Option<String>],
            &setup(1) as &[Option<String>],
            &setup(2) as &[Option<String>],
            &setup(3) as &[Option<String>],
            &setup(4) as &[Option<String>],
            &setup(5) as &[Option<String>],
            &setup(6) as &[Option<String>],
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn write_runs(conn: &mut PgConnection, runs: &[LegacyRun]) -> Result<(), sqlx::Error> {
    for batch in runs.chunks(BATCH) {
        let ids: Vec<i32> = batch.iter().map(|run| run.id).collect();
        let maps: Vec<i32> = batch.iter().map(|run| run.map_id).collect();
        let players: Vec<i64> = batch.iter().map(|run| run.player.get()).collect();
        let names: Vec<String> = batch.iter().map(|run| run.player_name.clone()).collect();
        let hostnames: Vec<String> = batch
            .iter()
            .map(|run| run.server_hostname.clone())
            .collect();
        let times: Vec<f64> = batch.iter().map(|run| run.time).collect();
        let syncs: Vec<f32> = batch.iter().map(|run| run.sync).collect();
        let strafes: Vec<i32> = batch.iter().map(|run| run.strafes).collect();
        let jumps: Vec<i32> = batch.iter().map(|run| run.jumps).collect();
        let finished: Vec<Option<DateTime<Utc>>> =
            batch.iter().map(|run| run.finished_at).collect();
        let initial: Vec<bool> = batch.iter().map(|run| run.initial_record).collect();
        let videos: Vec<Option<String>> = batch.iter().map(|run| run.video.clone()).collect();
        sqlx::query!(
            "INSERT INTO legacy_runs (id, map_id, player_steamid64, player_name, server_hostname, time, sync,
                 strafes, jumps, finished_at, initial_record, video)
             SELECT * FROM unnest($1::int[], $2::int[], $3::bigint[], $4::text[], $5::text[], $6::float8[],
                 $7::real[], $8::int[], $9::int[], $10::timestamptz[], $11::bool[], $12::text[])",
            &ids,
            &maps,
            &players,
            &names,
            &hostnames,
            &times,
            &syncs,
            &strafes,
            &jumps,
            &finished as &[Option<DateTime<Utc>>],
            &initial,
            &videos as &[Option<String>],
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Bans the player from everything, until lifted, as of the old ban's date, and takes any 2.0 runs they already
/// have off the boards. False when an earlier import carried this player's ban over already.
///
/// Sensitive path, the same steps as a staff ban (`staff/players.rs`): the player's row is locked first, and
/// the ban and its log entry land together. The entry has no actor, like other command-line actions, and is
/// marked `legacy` so a second import finds it.
async fn carry_ban_over(
    conn: &mut PgConnection,
    player: &LegacyPlayer,
    ban: &LegacyBan,
) -> Result<bool, sqlx::Error> {
    let steamid64 = player.steamid64;
    sqlx::query!(
        "INSERT INTO players (steamid64, name, name_seen_at, avatar_url, country_code)
         VALUES ($1, $2, '-infinity', $3, $4)
         ON CONFLICT (steamid64) DO UPDATE SET
             avatar_url = coalesce(players.avatar_url, excluded.avatar_url),
             country_code = coalesce(players.country_code, excluded.country_code)",
        steamid64.get(),
        player.name,
        player.avatar_url,
        player.country_code
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "SELECT 1 AS locked FROM players WHERE steamid64 = $1 FOR UPDATE",
        steamid64.get()
    )
    .fetch_one(&mut *conn)
    .await?;
    let carried_over = sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM bans JOIN staff_log ON staff_log.id = bans.log_id
               WHERE bans.player_steamid64 = $1 AND staff_log.detail @> '{"legacy": true}'
           ) AS "carried_over!""#,
        steamid64.get()
    )
    .fetch_one(&mut *conn)
    .await?;
    if carried_over {
        return Ok(false);
    }

    let restrictions = Restrictions::of(&Restriction::ALL);
    let banned_at = ban.banned_at.unwrap_or_else(Utc::now);
    let entry = log::Entry {
        actor: None,
        action: StaffAction::BanPlayer,
        target: &steamid64.to_string(),
        reason: Some(&ban.reason),
        detail: json!({
            "restrictions": restrictions.list(),
            "ends_at": null,
            "legacy": true,
            "banned_at": banned_at,
        }),
    };
    let log_id = log::record(&mut *conn, entry).await?;
    sqlx::query!(
        "INSERT INTO bans (player_steamid64, restrictions, reason, banned_at, log_id) VALUES ($1, $2, $3, $4, $5)",
        steamid64.get(),
        restrictions.bits(),
        ban.reason,
        banned_at,
        log_id
    )
    .execute(&mut *conn)
    .await?;
    invalidate_runs_of(conn, None, RunsOf::Player(steamid64), Some(&ban.reason)).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_old_sites_dates() {
        let at = |text| parse_date(text).map(|date| date.to_rfc3339());
        assert_eq!(
            at("2021-03-04 05:06:07"),
            Some("2021-03-04T05:06:07+00:00".to_owned())
        );
        assert_eq!(
            at("2021-03-04 05:06"),
            Some("2021-03-04T05:06:00+00:00".to_owned())
        );
        assert_eq!(
            at("2021-03-04"),
            Some("2021-03-04T00:00:00+00:00".to_owned())
        );
        assert_eq!(
            at("1614834367"),
            Some("2021-03-04T05:06:07+00:00".to_owned())
        );
        assert_eq!(at("2021-03-04 05:06.07"), None);
        assert_eq!(at(""), None);
    }

    #[test]
    fn reads_the_old_sites_countries() {
        assert_eq!(country_code("us"), Some("US"));
        assert_eq!(country_code("uk"), Some("GB"));
        assert_eq!(country_code("zz"), None);
    }

    #[sqlx::test]
    async fn imports_a_dump_and_carries_bans_over_once(db: PgPool) {
        let folder = std::env::temp_dir().join(format!("sj-legacy-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("sj_maps.sql"), MAPS).unwrap();
        std::fs::write(folder.join("sj_players.sql"), PLAYERS).unwrap();
        std::fs::write(folder.join("sj_times.sql"), TIMES).unwrap();

        let report = import(&db, &folder).await.unwrap();
        assert_eq!(
            (report.maps, report.players, report.runs, report.bans),
            (2, 2, 2, 1)
        );
        assert_eq!(report.skipped["run the old site marked invalid"], 1);
        assert_eq!(report.skipped["map name isn't one a map can have"], 1);
        assert_eq!(
            report.skipped["player isn't an individual Steam account"],
            1
        );
        assert_eq!(report.skipped["run by a player who wasn't imported"], 1);

        let map = sqlx::query!("SELECT tier, wr_run_id FROM legacy_maps WHERE name = 'bhop_a'")
            .fetch_one(&db)
            .await
            .unwrap();
        // The old record was the run it marked invalid, so no record link survives.
        assert_eq!((map.tier, map.wr_run_id), (Some(3), None));
        let other_map =
            sqlx::query_scalar!("SELECT wr_run_id FROM legacy_maps WHERE name = 'bhop_b'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(other_map, None, "run 10 is on bhop_a");
        let player = sqlx::query!(
            "SELECT country_code, setup_dpi FROM legacy_players WHERE steamid64 = 76561197960265730"
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(player.country_code.as_deref(), Some("GB"));
        assert_eq!(player.setup_dpi.as_deref(), Some("800"));

        let ban = sqlx::query!(
            "SELECT restrictions, reason, banned_at, ends_at FROM bans WHERE player_steamid64 = 76561197960265731"
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(ban.restrictions, Restrictions::of(&Restriction::ALL).bits());
        assert_eq!(ban.reason, "it's a hack");
        assert_eq!(ban.banned_at.to_rfc3339(), "2022-01-02T03:04:05+00:00");
        assert_eq!(ban.ends_at, None);

        // Each map is marked with whether it has runs, for the pre-2.0 leaderboards' "out of".
        let marked = sqlx::query!(
            r#"SELECT count(*) FILTER (WHERE has_runs) AS "with_runs!",
                      count(*) FILTER (WHERE has_runs <> EXISTS (
                          SELECT 1 FROM legacy_runs r WHERE r.map_id = m.id)) AS "wrong!"
               FROM legacy_maps m"#
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert!(marked.with_runs > 0);
        assert_eq!(marked.wrong, 0);

        let again = import(&db, &folder).await.unwrap();
        assert_eq!((again.runs, again.bans), (2, 0));
        assert_eq!(again.skipped["ban already carried over"], 1);
        let bans = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM bans"#)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(bans, 1);
        std::fs::remove_dir_all(folder).unwrap();
    }

    const MAPS: &str = "\
CREATE TABLE `maps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `map` varchar(64) NOT NULL,
  `tier` int unsigned NOT NULL DEFAULT '0',
  `wr_id` int unsigned DEFAULT NULL,
  `old_wr_id` int unsigned DEFAULT NULL,
  `points` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT INTO `maps` VALUES (1,'bhop_a',3,12,NULL,30),(2,'bhop_b',0,10,NULL,0),(3,'bhop_c (1)',2,NULL,NULL,0);
";

    const PLAYERS: &str = "\
CREATE TABLE `players` (
  `steamid` varchar(32) NOT NULL,
  `name` varchar(64) DEFAULT NULL,
  `alias` varchar(64) DEFAULT NULL,
  `avatar` varchar(128) DEFAULT NULL,
  `banned` tinyint unsigned DEFAULT NULL,
  `ban_reason` varchar(512) DEFAULT NULL,
  `ban_date` varchar(45) DEFAULT NULL,
  `country` varchar(16) DEFAULT NULL,
  `setup_mouse` varchar(64) DEFAULT NULL,
  `setup_mouse_pad` varchar(64) DEFAULT NULL,
  `setup_dpi` varchar(64) DEFAULT NULL,
  `setup_sens` varchar(64) DEFAULT NULL,
  `setup_monitor` varchar(64) DEFAULT NULL,
  `setup_aspect` varchar(64) DEFAULT NULL,
  `setup_keyboard` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`steamid`)
) ENGINE=InnoDB;
INSERT INTO `players` VALUES ('[U:1:2]','alpha',NULL,'http://not-https/a.jpg',NULL,NULL,NULL,'uk',NULL,NULL,'800',NULL,NULL,NULL,NULL),('[U:1:3]','beta',NULL,NULL,1,'it\\'s a hack','2022-01-02 03:04:05',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('[I:1:4]','gamma',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
";

    const TIMES: &str = "\
CREATE TABLE `times` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ip` varchar(45) DEFAULT NULL,
  `hostname` varchar(128) DEFAULT NULL,
  `map` varchar(64) DEFAULT NULL,
  `name` varchar(45) DEFAULT NULL,
  `steamid` varchar(32) NOT NULL,
  `time` float unsigned DEFAULT NULL,
  `sync` float unsigned DEFAULT NULL,
  `strafes` int unsigned DEFAULT NULL,
  `jumps` int unsigned DEFAULT NULL,
  `date` varchar(45) DEFAULT NULL,
  `invalid` varchar(148) DEFAULT NULL,
  `initial_record` tinyint unsigned DEFAULT NULL,
  `video` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT INTO `times` VALUES (10,'192.0.2.1','Server A','bhop_a','alpha','[U:1:2]',12.5,90.1,20,30,'2021-03-04 05:06:07',NULL,1,NULL),(11,'192.0.2.1','Server A','bhop_b','beta','STEAM_0:1:1',20,88,10,15,'2021-03-04',NULL,NULL,'dQw4w9WgXcQ');
INSERT INTO `times` VALUES (12,'192.0.2.1','Server A','bhop_a','beta','[U:1:3]',11,90,20,30,'2021-03-05 00:00:00','speedhack',NULL,NULL),(13,'192.0.2.1','Server A','bhop_a','x','[U:1:99]',11,90,20,30,'2021-03-05 00:00:00',NULL,NULL,NULL);
";
}
