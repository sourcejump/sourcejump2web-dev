//! SourceJump API server: connects to Postgres, applies migrations and serves the router.
//! Also a small CLI for staff tasks on the server itself; run it with `help` for the commands. Staff actions
//! taken here are logged with no actor.

mod anticheat;
mod app;
mod auth;
mod client_address;
#[cfg(test)]
mod contract;
mod daily_totals;
mod error;
mod etag;
mod health;
mod json_body;
mod leaderboards;
mod legacy;
mod maps;
mod name_search;
mod players;
mod plugin_releases;
mod policies;
mod posts;
mod query_time_limit;
mod record_events;
mod records;
mod replays;
mod ruleset;
mod runs;
mod servers;
mod staff;
mod steam;
mod storage;
#[cfg(test)]
mod test_client;
mod zones;

use std::{error::Error, io::IsTerminal, net::SocketAddr, path::Path};

use players::privileges::{Privilege, Privileges};
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tracing_subscriber::EnvFilter;

const USAGE: &str = "\
usage: sourcejump-api [command]
  (no command)               serve the API
  openapi                    print the OpenAPI spec (needs no database)
  keys issue <server name>   create a server and print its first API key (logged)
  keys revoke <key prefix>   revoke a key; every request with it is refused from then on (logged)
  servers seen               every server that has sent a heartbeat, newest first
  servers list <ip:port>     show a server on the site's server list (logged)
  servers unlist <ip:port>   take it off the list (logged)
  zones import <map> <file>  publish a shavit zones JSON file as the map's next zone set (logged)
  zones import-folder <folder> <note> [--dry-run]   give each <map>.json's map its first zone set, skipping
                             maps that have zones (each logged with the note)
  tiers count <n>            publish the number of tiers (community policy; logged)
  maps tier <map> <track> <tier>   assign a tier to a map's track, 0 being the main track (logged)
  maps image <map> <file>               add a picture to a map (logged)
  maps import-pictures <folder> <note> [--dry-run]   give each <map>/ folder's map its first pictures, skipping
                             maps that have pictures (each map logged with the note)
  maps viewer-file <map> <file>         pack a .bsp or .bsp.bz2 as the map's viewer file (logged)
  maps stock-content <css folder>       upload CS:S's stock VPKs for the viewer from a CS:S install
  privileges grant <steamid> <privilege>...   give a player staff privileges (logged)
  privileges revoke <steamid> <privilege>...  take them away again (logged)
  privileges list            name every privilege
  legacy import <dump folder>   replace the pre-2.0 records with the old site's dump, carrying its bans over (logged)
  world-records rebuild      recount the stored world records from the runs and say how many rows were wrong";

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();

    match args.as_slice() {
        [] => serve().await,
        ["openapi"] => {
            println!("{}", app::openapi().to_pretty_json()?);
            Ok(())
        }
        ["keys", "issue", server_name] => {
            let server = staff::keys::KeyFor::NewServer(server_name);
            let issued = staff::keys::issue(&connect().await?, None, server)
                .await?
                .expect("a new server always gets its key")
                .issued;
            println!("Server {} created.", issued.server_id);
            println!("API key (shown once, store it now): {}", issued.key);
            println!("Key prefix, for revoking: {}", issued.prefix);
            Ok(())
        }
        ["keys", "revoke", prefix] => {
            if staff::keys::revoke(&connect().await?, None, prefix, None, false).await? {
                println!("Revoked {prefix}.");
                Ok(())
            } else {
                Err(format!("no active key starts with {prefix}").into())
            }
        }
        ["servers", "seen"] => print_seen_servers(&connect().await?).await,
        ["servers", action @ ("list" | "unlist"), address] => {
            change_listing(&connect().await?, action == &"list", address).await
        }
        ["zones", "import", map, file] => import_zones(map, file).await,
        ["zones", "import-folder", folder, note, rest @ ..] => {
            let dry_run = match rest {
                [] => false,
                ["--dry-run"] => true,
                _ => return Err(USAGE.into()),
            };
            import_zone_folder(folder, note, dry_run).await
        }
        ["tiers", "count", count] => {
            let db = connect().await?;
            let based_on = policies::current_version(&mut *db.acquire().await?, "tiers").await?;
            let policy = policies::Policy::Tiers(policies::TiersPolicy {
                count: count.parse()?,
            });
            let version = staff::policies::publish_policy(&db, None, based_on, &policy, None)
                .await
                .map_err(|error| format!("not published: {error:?}"))?;
            println!("Published {count} tiers as tiers policy version {version}.");
            Ok(())
        }
        ["maps", "tier", map, track, tier] => {
            let map = maps::MapName::try_from((*map).to_owned())?;
            staff::maps::set_tier(&connect().await?, None, &map, track.parse()?, tier.parse()?)
                .await
                .map_err(|error| format!("not set: {error:?}"))?;
            println!("{} track {track} is now tier {tier}.", map.as_str());
            Ok(())
        }
        ["maps", "image", map, file] => {
            let map = maps::MapName::try_from((*map).to_owned())?;
            let (db, storage) = (connect().await?, storage::Storage::from_env()?);
            let upload = std::fs::read(file).map_err(|error| format!("{file}: {error}"))?;
            staff::map_images::add_image(&db, &storage, None, &map, upload)
                .await
                .map_err(|error| format!("not added: {error:?}"))?;
            println!("Added the picture to {}.", map.as_str());
            Ok(())
        }
        ["maps", "import-pictures", folder, note, rest @ ..] => {
            import_picture_folder(folder, note, rest).await
        }
        ["maps", "viewer-file", map, file] => make_viewer_file(map, file).await,
        ["maps", "stock-content", folder] => upload_stock_content(folder).await,
        ["privileges", "list"] => {
            for privilege in Privilege::ALL {
                println!("{}", privilege.name());
            }
            Ok(())
        }
        [
            "privileges",
            action @ ("grant" | "revoke"),
            steamid,
            names @ ..,
        ] if !names.is_empty() => {
            change_privileges(&connect().await?, action == &"grant", steamid, names).await
        }
        ["legacy", "import", folder] => import_legacy(folder).await,
        ["world-records", "rebuild"] => rebuild_world_records().await,
        ["help" | "--help"] => {
            println!("{USAGE}");
            Ok(())
        }
        _ => Err(USAGE.into()),
    }
}

async fn make_viewer_file(map: &str, file: &str) -> Result<(), Box<dyn Error>> {
    let map = maps::MapName::try_from(map.to_owned())?;
    let (db, storage) = (connect().await?, storage::Storage::from_env()?);
    let file = std::fs::read(file).map_err(|error| format!("{file}: {error}"))?;
    let packed = viewer_pack::pack(&file, |_| {})?;
    let stored = packed.file.len();
    staff::map_viewer_file::upload_viewer_file(&db, &storage, None, &map, packed.file)
        .await
        .map_err(|error| format!("not stored: {error:?}"))?;
    println!(
        "Packed {}'s viewer file: {} bytes as .bsp, {} stripped, {stored} stored.",
        map.as_str(),
        packed.source_bytes,
        packed.stripped_bytes,
    );
    Ok(())
}

async fn import_zones(map: &str, file: &str) -> Result<(), Box<dyn Error>> {
    let map = maps::MapName::try_from(map.to_owned())?;
    let zone_set = zones::parse(&std::fs::read_to_string(file)?)?;
    let db = connect().await?;
    let based_on = sqlx::query_scalar!(
        "SELECT max(z.version) FROM map_zones z JOIN maps m ON m.id = z.map_id WHERE m.name = $1",
        map.as_str()
    )
    .fetch_one(&db)
    .await?;
    let version = staff::maps::publish_zones(&db, None, &map, based_on, &zone_set, None)
        .await
        .map_err(|error| format!("not published: {error:?}"))?;
    println!("Published zone set version {version} for {}.", map.as_str());
    Ok(())
}

async fn import_zone_folder(folder: &str, note: &str, dry_run: bool) -> Result<(), Box<dyn Error>> {
    let db = connect().await?;
    let report = zones::folder::import_folder(&db, Path::new(folder), note, dry_run).await?;
    for (file, why) in &report.skipped {
        println!("skipped {file}: {why}");
    }
    let verb = if dry_run { "Would import" } else { "Imported" };
    println!(
        "{verb} zones for {} maps; skipped {} files.",
        report.imported.len(),
        report.skipped.len()
    );
    Ok(())
}

async fn import_picture_folder(
    folder: &str,
    note: &str,
    flags: &[&str],
) -> Result<(), Box<dyn Error>> {
    let dry_run = match flags {
        [] => false,
        ["--dry-run"] => true,
        _ => return Err(USAGE.into()),
    };
    let (db, storage) = (connect().await?, storage::Storage::from_env()?);
    let report = maps::image::folder::import_folder(
        &db,
        &storage,
        Path::new(folder),
        note,
        dry_run,
        |done, total| eprint!("\r{done}/{total} maps"),
    )
    .await?;
    if !dry_run {
        eprintln!();
    }
    for (map, why) in &report.skipped_maps {
        println!("skipped {map}: {why}");
    }
    for (picture, why) in &report.skipped_pictures {
        println!("left out {picture}: {why}");
    }
    let verb = if dry_run { "Would give" } else { "Gave" };
    println!(
        "{verb} {} maps {} pictures; skipped {} maps and left out {} pictures.",
        report.imported.len(),
        report
            .imported
            .iter()
            .map(|(_, count)| count)
            .sum::<usize>(),
        report.skipped_maps.len(),
        report.skipped_pictures.len()
    );
    Ok(())
}

async fn rebuild_world_records() -> Result<(), Box<dyn Error>> {
    let changed = leaderboards::world_records::rebuild(&connect().await?).await?;
    println!("Recounted the world records: {changed} rows changed.");
    Ok(())
}

async fn import_legacy(folder: &str) -> Result<(), Box<dyn Error>> {
    let report = legacy::import::import(&connect().await?, std::path::Path::new(folder)).await?;
    println!(
        "Imported {} maps, {} players and {} runs; carried {} bans over.",
        report.maps, report.players, report.runs, report.bans
    );
    for (reason, count) in &report.skipped {
        println!("  left out: {count} × {reason}");
    }
    Ok(())
}

async fn upload_stock_content(folder: &str) -> Result<(), Box<dyn Error>> {
    let storage = storage::Storage::from_env()?;
    let uploaded = maps::stock_content::upload(&storage, std::path::Path::new(folder)).await?;
    println!("Uploaded {uploaded} files; the rest were already stored.");
    Ok(())
}

async fn change_privileges(
    db: &PgPool,
    grant: bool,
    steamid: &str,
    names: &[&str],
) -> Result<(), Box<dyn Error>> {
    let steamid64 = players::SteamId64::parse_any(steamid)
        .ok_or_else(|| format!("{steamid:?} is not a player's SteamID"))?;
    let requested = names
        .iter()
        .map(|name| {
            Privilege::from_name(name).ok_or_else(|| {
                format!("no privilege is called {name:?}; `privileges list` names them")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let requested = Privileges::of(&requested);
    let (grant, revoke) = if grant {
        (requested, Privileges::default())
    } else {
        (Privileges::default(), requested)
    };
    let held = staff::privileges::change(db, None, steamid64, grant, revoke, None)
        .await
        .map_err(|error| match error {
            staff::ChangeError::Invalid(message) => message,
            error => format!("not changed: {error:?}"),
        })?;
    let names: Vec<&str> = held.list().into_iter().map(Privilege::name).collect();
    let held = if names.is_empty() {
        "nothing".to_owned()
    } else {
        names.join(", ")
    };
    println!("{steamid64} now holds: {held}");
    Ok(())
}

async fn print_seen_servers(db: &PgPool) -> Result<(), Box<dyn Error>> {
    for server in servers::listing::seen(db).await? {
        let players = if server.players == 1 {
            "player"
        } else {
            "players"
        };
        let mut notes = vec![format!("{} {players}", server.players)];
        if server.keyed {
            notes.push("keyed".to_owned());
        }
        if server.listed {
            notes.push("listed".to_owned());
        }
        if let Some(ip) = server.reported_ip {
            notes.push(format!("says its IP is {ip}"));
        }
        println!(
            "{}  {}  last seen {}  ({})",
            server.address,
            server.hostname,
            server.last_seen_at.format("%Y-%m-%d %H:%M UTC"),
            notes.join(", ")
        );
    }
    Ok(())
}

async fn change_listing(db: &PgPool, list: bool, address: &str) -> Result<(), Box<dyn Error>> {
    let address: SocketAddr = address
        .parse()
        .map_err(|_| format!("{address:?} isn't an address like 203.0.113.10:27015"))?;
    let changed = staff::servers::set_listed(db, None, address, list).await?;
    let outcome = match (list, changed) {
        (true, true) => "is now listed",
        (true, false) => "was already listed",
        (false, true) => "is no longer listed",
        (false, false) => "wasn't listed",
    };
    println!("{address} {outcome}.");
    Ok(())
}

async fn serve() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        // Colors only on a terminal; under systemd they'd show up as escape codes in the journal.
        .with_ansi(std::io::stdout().is_terminal())
        .init();

    let addr: SocketAddr = std::env::var("SJ_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()
        .map_err(|_| "SJ_BIND must be an address like 127.0.0.1:8080")?;
    let public_url: url::Url = std::env::var("SJ_PUBLIC_URL")
        .map_err(|_| "SJ_PUBLIC_URL must be set, e.g. https://sourcejump.net")?
        .parse()
        .map_err(|_| "SJ_PUBLIC_URL must be a URL like https://sourcejump.net")?;
    let db = connect().await?;
    let storage = storage::Storage::from_env()?;
    let staging = storage::Staging::from_env()?;
    let discord_feeds = record_events::discord::feeds_from_env()?;

    // In the background: a full recount takes minutes on a lot of data, and pages can show the totals counted
    // before meanwhile.
    tokio::spawn(leaderboards::standings::recount_if_stale(db.clone()));
    // In the background: storage being down shouldn't keep the API from starting.
    tokio::spawn(replays::download::forget_derived_shavit_files_at_start(
        db.clone(),
        storage.clone(),
    ));
    tokio::spawn(replays::processing::run(
        db.clone(),
        storage.clone(),
        staging.clone(),
    ));
    tokio::spawn(daily_totals::run(db.clone()));
    tokio::spawn(leaderboards::standings::watch_ended_bans(db.clone()));
    tokio::spawn(record_events::run(db.clone()));
    tokio::spawn(servers::heartbeat::run(db.clone()));
    let (wake_streams, record_events) = tokio::sync::watch::channel(());
    let listener_task = tokio::spawn(record_events::stream::listen(db.clone(), wake_streams));
    let record_feed = record_events::stream::Feed::start(db.clone(), record_events.clone());
    let links = record_events::discord::Links {
        public_url: public_url.clone(),
        storage: storage.clone(),
    };
    record_events::discord::start(&db, discord_feeds, &links, &record_events);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "listening");
    // Requests get their own pool, with the statement time limit; the jobs above keep `db`, which has none.
    let requests = PgPoolOptions::new()
        .max_connections(10)
        .connect_with(query_time_limit::apply((*db.connect_options()).clone()))
        .await?;
    let state = app::AppState {
        db: requests,
        storage,
        staging,
        steam: steam::Steam::new(),
        public_url,
        record_feed,
        stream_slots: record_events::stream::StreamSlots::default(),
        replay_rebuilds: replays::download::RebuildSlots::new(),
        heartbeat_limit: servers::heartbeat_limit::HeartbeatLimit::default(),
    };
    // Connect info lets endpoints see who connected (`client_address.rs`).
    axum::serve(
        listener,
        app::router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_signal().await;
        // Drops the wake sender, which ends the reader and with it every open record stream; otherwise
        // they would hold the shutdown open.
        listener_task.abort();
    })
    .await?;
    Ok(())
}

/// Connects to `DATABASE_URL` and applies pending migrations.
async fn connect() -> Result<PgPool, Box<dyn Error>> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL must be set, e.g. postgres:///sourcejump")?;
    // JIT compiling pays off for long analytical queries, not for the API's small indexed ones: the planner's
    // cost estimates still trip it, and compiling then takes far longer than running the query.
    let options = database_url
        .parse::<PgConnectOptions>()?
        .options([("jit", "off")]);
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect_with(options)
        .await?;
    // One API instance per environment, restarted on every deploy, so migrating at startup keeps the
    // schema in step with the binary. Migrations stay additive, so an older binary still runs on a newer
    // schema; sqlx would refuse to start it over migrations it doesn't know, so those are ignored.
    let mut migrator = sqlx::migrate!();
    migrator.set_ignore_missing(true);
    migrator.run(&db).await?;
    Ok(db)
}

// systemd stops services with SIGTERM; finishing in-flight requests keeps a retried run submission from racing a half-done one.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    // SIGTERM exists only on Unix; elsewhere (a contributor's Windows machine) Ctrl+C is the only way to stop.
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
