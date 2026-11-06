//! The replay job: finds uploaded replays, checks each against its run, and stores the good ones as SJR.
//!
//! Servers upload straight to the private staging bucket and tell the API nothing, so the job lists the
//! upload folder instead. One listing covers every pending upload however many runs are waiting, and a
//! complete upload is all that appears there: S3 only shows an object once its upload has finished. Only
//! the SJR the job built from a checked upload reaches the public bucket, so nothing a server uploads is
//! ever served as it sent it. A bad upload is deleted and its reason kept; the server may upload again with
//! a fresh link. A stored replay is final.

use std::time::Duration;

use sqlx::PgPool;

use sqlx::types::Json as JsonColumn;

use super::{MAX_REPLAY_BYTES, UPLOAD_PREFIX, header, route, sjr};
use crate::{
    players::INDIVIDUAL_BASE,
    record_events,
    storage::{Staged, Staging, Storage, StoredObject, random_key_part},
};

/// How often the job looks for uploads. Replays aren't needed the moment a run ends; this keeps the
/// listing requests to a couple a minute.
const INTERVAL: Duration = Duration::from_secs(30);

/// Runs for as long as the API does. The API runs as one process, so only one job lists at a time.
pub async fn run(db: PgPool, storage: Storage, staging: Staging) {
    let mut ticks = tokio::time::interval(INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        // Only listing the uploads fails the whole tick; each upload's own errors are logged as it goes.
        if let Err(error) = process_uploads(&db, &storage, &staging).await {
            tracing::error!(%error, "replay job couldn't list uploads; trying again later");
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Processed {
    pub stored: usize,
    pub refused: usize,
    /// Uploads no request matches, or late repeats of a replay already stored.
    pub discarded: usize,
    /// Uploads that hit an error and are left for the next tick.
    pub failed: usize,
}

pub async fn process_uploads(
    db: &PgPool,
    storage: &Storage,
    staging: &Staging,
) -> Result<Processed, Box<dyn std::error::Error + Send + Sync>> {
    let mut processed = Processed::default();
    for upload in staging.list(UPLOAD_PREFIX).await? {
        // One upload failing (storage refusing that object, a database error) is skipped and tried again
        // next tick. Ending the tick instead would stop every upload listed after it, on every tick.
        let outcome = match process(db, storage, staging, &upload).await {
            Ok(outcome) => outcome,
            Err(error) => {
                tracing::error!(key = upload.key, %error, "replay upload failed; trying it again later");
                processed.failed += 1;
                continue;
            }
        };
        match outcome {
            Outcome::Stored => processed.stored += 1,
            Outcome::Refused(reason) => {
                tracing::warn!(key = upload.key, reason, "replay upload refused");
                processed.refused += 1;
            }
            Outcome::Discarded => processed.discarded += 1,
        }
        // Deleted only after the database has the outcome, so a failure in between means the upload is
        // looked at again, never lost.
        if let Err(error) = staging.delete(&upload.key).await {
            tracing::error!(key = upload.key, %error, "replay upload not deleted; it is looked at again");
        }
    }
    Ok(processed)
}

enum Outcome {
    Stored,
    Refused(String),
    Discarded,
}

/// What the upload is checked against.
#[derive(Clone)]
struct Expected {
    run_id: i64,
    already_stored: bool,
    map: String,
    track: i16,
    steamid64: i64,
    time: f64,
    tickrate: f32,
}

async fn process(
    db: &PgPool,
    storage: &Storage,
    staging: &Staging,
    upload: &StoredObject,
) -> Result<Outcome, Box<dyn std::error::Error + Send + Sync>> {
    let expected = sqlx::query_as!(
        Expected,
        r#"
        SELECT p.run_id, p.stored_key IS NOT NULL AS "already_stored!", m.name AS map, r.track,
               r.player_steamid64 AS steamid64, r.time, r.tickrate
        FROM replays p JOIN runs r ON r.id = p.run_id JOIN maps m ON m.id = r.map_id
        WHERE p.upload_key = $1
        "#,
        upload.key
    )
    .fetch_optional(db)
    .await?;
    let Some(expected) = expected.filter(|expected| !expected.already_stored) else {
        return Ok(Outcome::Discarded);
    };

    // The listed size is only what was there then: the server holds the link for an hour and may replace
    // the file before it's read, so the read itself stops past the limit.
    let too_large = || {
        Err(format!(
            "the file is over {MAX_REPLAY_BYTES} bytes; larger replays aren't accepted"
        ))
    };
    let checked = if usize::try_from(upload.size).map_or(true, |size| size > MAX_REPLAY_BYTES) {
        too_large()
    } else {
        match staging.read(&upload.key, MAX_REPLAY_BYTES).await? {
            // Deleted between the listing and now, by an earlier run of the job that failed later on.
            Staged::Missing => return Ok(Outcome::Discarded),
            Staged::TooLarge => too_large(),
            Staged::Bytes(file) => {
                // Parsing, compressing at gzip's highest level and tracing the route of a file up to 128 MB
                // take seconds of CPU: off the async workers, so requests aren't held up meanwhile.
                let run = expected.clone();
                tokio::task::spawn_blocking(move || {
                    check(&file, &run).map(|header| {
                        (
                            sjr::encode(&file, &header),
                            route::route(&file, &header),
                            file.len(),
                        )
                    })
                })
                .await?
            }
        }
    };

    match checked {
        Ok((sjr, route, raw_len)) => {
            let stored_key = format!("replays/{}-{}.sjr", expected.run_id, random_key_part());
            let stored_len = sjr.len();
            storage
                .put_immutable(&stored_key, "application/octet-stream", None, sjr)
                .await?;
            let mut tx = db.begin().await?;
            sqlx::query!(
                r#"UPDATE replays SET stored_key = $2, stored_at = now(), raw_bytes = $3, stored_bytes = $4,
                       route = $5, refused_at = NULL, refused_reason = NULL
                   WHERE run_id = $1"#,
                expected.run_id,
                stored_key,
                i32::try_from(raw_len)?,
                i32::try_from(stored_len)?,
                JsonColumn(route) as _
            )
            .execute(&mut *tx)
            .await?;
            record_events::record(&mut tx, record_events::Kind::Replay, &[expected.run_id]).await?;
            tx.commit().await?;
            Ok(Outcome::Stored)
        }
        Err(reason) => {
            sqlx::query!(
                "UPDATE replays SET refused_at = now(), refused_reason = $2 WHERE run_id = $1",
                expected.run_id,
                reason
            )
            .execute(db)
            .await?;
            Ok(Outcome::Refused(reason))
        }
    }
}

/// Whether the file is the recording of this run. The style isn't compared: the file holds shavit's style
/// number on that server, while SourceJump knows styles by their settings.
fn check(file: &[u8], run: &Expected) -> Result<header::ReplayHeader, String> {
    let header = header::parse(file)?;
    // shavit writes the map name as the server has it, while runs carry it lowercased (`MapName`).
    if header.map.to_lowercase() != run.map {
        return Err(format!(
            "the replay is of {}, the run of {}",
            header.map, run.map
        ));
    }
    if i16::from(header.track) != run.track {
        return Err(format!(
            "the replay is of track {}, the run of track {}",
            header.track, run.track
        ));
    }
    let steamid64 = i64::try_from(INDIVIDUAL_BASE + u64::from(header.account_id))
        .expect("an individual SteamID64 fits in an i64");
    if steamid64 != run.steamid64 {
        return Err("the replay is of another player".to_owned());
    }
    // A NaN in the file would pass a plain `>`: every comparison with NaN is false.
    if !header.tickrate.is_finite() || (header.tickrate - run.tickrate).abs() > 0.01 {
        return Err(format!(
            "the replay was recorded at {} tick, the run at {}",
            header.tickrate, run.tickrate
        ));
    }
    // The header stores the time as a 32-bit float, so allow for its rounding: half a tick is far beyond
    // that and still tells runs apart.
    let half_tick = 0.5 / f64::from(run.tickrate);
    if !header.time.is_finite() || (f64::from(header.time) - run.time).abs() > half_tick {
        return Err(format!(
            "the replay's time is {:.3} s, the run's {:.3} s",
            header.time, run.time
        ));
    }
    Ok(header)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::{Processed, process_uploads};
    use crate::replays::download::forget_derived_shavit_files;
    use crate::{
        replays::{
            UPLOAD_PREFIX,
            header::{self, tests::MAZE},
            sjr,
        },
        runs::{RunAccepted, tests::setup},
        storage::{Staging, Storage},
        test_client,
    };

    /// The sample replay's run, as its server would submit it.
    fn maze_run(server_run_id: &str) -> Value {
        let header = header::parse(MAZE).unwrap();
        let mut run = crate::runs::tests::run(server_run_id, f64::from(header.time));
        run["map"] = json!("bhop_maze");
        run["player"]["steamid64"] =
            json!((crate::players::INDIVIDUAL_BASE + u64::from(header.account_id)).to_string());
        run
    }

    /// Submits the run and returns the key its replay is uploaded to.
    async fn submit(db: &PgPool, key: &str, run: &Value) -> String {
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(key), run)
            .await
            .json();
        let url = accepted.replay.expect("the replay is wanted").upload_url;
        let path = url::Url::parse(&url).unwrap().path().to_owned();
        assert!(
            path.starts_with("/test-staging/"),
            "uploads go to the private bucket: {url}"
        );
        let at = path.find(UPLOAD_PREFIX).expect("an upload key");
        path[at..].to_owned()
    }

    fn upload(staging: &Staging, key: &str, file: &[u8]) {
        staging.objects().insert(key.to_owned(), file.to_vec());
    }

    fn upload_to(storage: &Storage, key: &str, file: &[u8]) {
        storage
            .objects
            .lock()
            .unwrap()
            .insert(key.to_owned(), file.to_vec());
    }

    fn keys(storage: &Storage) -> Vec<String> {
        let mut keys: Vec<String> = storage.objects.lock().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    }

    #[sqlx::test]
    async fn a_good_upload_is_stored_as_sjr_and_the_upload_removed(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        upload(&staging, &upload_key, MAZE);

        let processed = process_uploads(&db, &storage, &staging).await.unwrap();

        assert_eq!(
            processed,
            Processed {
                stored: 1,
                ..Processed::default()
            }
        );
        let replay_events: i64 =
            sqlx::query_scalar("SELECT count(*) FROM record_events WHERE kind = 'replay'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(replay_events, 1);
        assert!(staging.objects().is_empty(), "the upload is removed");
        let stored = keys(&storage);
        assert_eq!(stored.len(), 1);
        assert!(
            stored[0].starts_with("replays/")
                && std::path::Path::new(&stored[0]).extension() == Some("sjr".as_ref())
        );
        let sjr_file = storage.objects.lock().unwrap()[&stored[0]].clone();
        assert_eq!(sjr::decode(&sjr_file).unwrap(), MAZE);
        let (raw, kept): (i32, i32) =
            sqlx::query_as("SELECT raw_bytes, stored_bytes FROM replays WHERE stored_key = $1")
                .bind(&stored[0])
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(usize::try_from(raw).unwrap(), MAZE.len());
        assert!(kept * 3 < raw);
        let points: i64 =
            sqlx::query_scalar("SELECT jsonb_array_length(route)::bigint FROM replays")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(points, 200, "the route is kept for the run page");
    }

    #[sqlx::test]
    async fn a_replay_of_a_map_named_with_capitals_matches_its_lowercased_run(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        let file = replay_of_map(MAZE, "bhop_maze", "bhop_Maze");
        upload(&staging, &upload_key, &file);

        let processed = process_uploads(&db, &storage, &staging).await.unwrap();

        assert_eq!(processed.stored, 1, "{processed:?}");
        let stored = keys(&storage);
        let sjr_file = storage.objects.lock().unwrap()[&stored[0]].clone();
        assert_eq!(sjr::decode(&sjr_file).unwrap(), file, "kept byte for byte");
    }

    /// The replay with its header's map name swapped for another of the same length.
    fn replay_of_map(file: &[u8], from: &str, to: &str) -> Vec<u8> {
        assert_eq!(from.len(), to.len());
        let at = file
            .windows(from.len())
            .position(|window| window == from.as_bytes())
            .expect("the header names the map");
        let mut file = file.to_vec();
        file[at..at + to.len()].copy_from_slice(to.as_bytes());
        file
    }

    #[sqlx::test]
    async fn the_first_download_keeps_the_shavit_file_for_the_rest(db: PgPool) {
        let key = setup(&db).await;
        let state = crate::app::AppState::for_tests(db.clone());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        upload(&state.staging, &upload_key, MAZE);
        process_uploads(&db, &state.storage, &state.staging)
            .await
            .unwrap();
        let run_id: i64 = sqlx::query_scalar("SELECT id FROM runs")
            .fetch_one(&db)
            .await
            .unwrap();
        let download = async || {
            let request = axum::http::Request::get(format!("/v1/replays/{run_id}"))
                .body(axum::body::Body::empty())
                .unwrap();
            test_client::send_to(state.clone(), request).await
        };

        let first = download().await;
        assert_eq!(first.status, 200);
        assert_eq!(&first.body[..], MAZE, "rebuilt byte for byte");
        assert_eq!(first.headers["content-length"], MAZE.len().to_string());
        let (sjr_key, kept): (String, String) =
            sqlx::query_as("SELECT stored_key, shavit_key FROM replays")
                .fetch_one(&db)
                .await
                .unwrap();
        assert!(
            kept.starts_with("replays/") && kept.ends_with(".replay"),
            "{kept}"
        );
        assert_ne!(
            kept.trim_end_matches(".replay"),
            sjr_key.trim_end_matches(".sjr"),
            "the SJR's public key doesn't give the kept file's away"
        );

        // Without the SJR, only the kept file can answer.
        let sjr_file = state.storage.objects.lock().unwrap().remove(&sjr_key);
        assert!(sjr_file.is_some());
        let second = download().await;
        assert_eq!(second.status, 200);
        assert_eq!(&second.body[..], MAZE);
    }

    #[sqlx::test]
    async fn shavit_files_kept_under_a_guessable_key_are_deleted_and_rebuilt(db: PgPool) {
        let key = setup(&db).await;
        let state = crate::app::AppState::for_tests(db.clone());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        upload(&state.staging, &upload_key, MAZE);
        process_uploads(&db, &state.storage, &state.staging)
            .await
            .unwrap();
        // As the first download kept it before kept files got their own random part.
        let sjr_key: String = sqlx::query_scalar("SELECT stored_key FROM replays")
            .fetch_one(&db)
            .await
            .unwrap();
        let derived = sjr_key.replace(".sjr", ".replay");
        upload_to(&state.storage, &derived, MAZE);
        sqlx::query("UPDATE replays SET shavit_key = $1")
            .bind(&derived)
            .execute(&db)
            .await
            .unwrap();

        let forget = || forget_derived_shavit_files(&db, &state.storage);
        assert_eq!(forget().await.unwrap(), 1);
        assert!(!keys(&state.storage).contains(&derived), "deleted");
        assert_eq!(forget().await.unwrap(), 0, "nothing left the next time");

        let run_id: i64 = sqlx::query_scalar("SELECT id FROM runs")
            .fetch_one(&db)
            .await
            .unwrap();
        let request = axum::http::Request::get(format!("/v1/replays/{run_id}"))
            .body(axum::body::Body::empty())
            .unwrap();
        let rebuilt = test_client::send_to(state.clone(), request).await;
        assert_eq!(&rebuilt.body[..], MAZE);
        let kept: String = sqlx::query_scalar("SELECT shavit_key FROM replays")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_ne!(kept, derived);
    }

    #[sqlx::test]
    async fn an_invalidated_runs_replay_can_be_watched_but_not_downloaded(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        upload(&staging, &upload_key, MAZE);
        process_uploads(&db, &storage, &staging).await.unwrap();
        let run_id: i64 = sqlx::query_scalar("SELECT id FROM runs")
            .fetch_one(&db)
            .await
            .unwrap();
        let log_id: i64 = sqlx::query_scalar(
            "INSERT INTO staff_log (action, target, reason) VALUES ('invalidate_run', '1', 'x') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        crate::runs::invalidation::invalidate(&mut db.acquire().await.unwrap(), &[run_id], log_id)
            .await
            .unwrap();

        let run: Value = test_client::get(&db, &format!("/v1/runs/{run_id}"))
            .await
            .json();
        assert_eq!(run["invalidated"], true);
        assert!(
            run["replay"]["sjr_url"].is_string(),
            "the run page can play it"
        );
        let file = test_client::get(&db, &format!("/v1/replays/{run_id}")).await;
        assert_eq!(file.status, 404, "the file isn't handed out");
    }

    #[sqlx::test]
    async fn an_upload_that_isnt_the_runs_replay_is_refused_and_may_be_sent_again(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let mut slower = maze_run("a");
        slower["time"] = json!(slower["time"].as_f64().unwrap() + 1.0);
        let upload_key = submit(&db, &key, &slower).await;
        upload(&staging, &upload_key, MAZE);

        let processed = process_uploads(&db, &storage, &staging).await.unwrap();

        assert_eq!(processed.refused, 1);
        assert!(staging.objects().is_empty(), "the bad upload is deleted");
        assert!(
            keys(&storage).is_empty(),
            "nothing reaches the public bucket"
        );
        let reason: String = sqlx::query_scalar("SELECT refused_reason FROM replays")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(reason.contains("time"), "{reason}");
        let resent: RunAccepted = test_client::post(&db, "/v1/runs", Some(&key), &slower)
            .await
            .json();
        let refusal = resent
            .replay
            .and_then(|replay| replay.last_refusal)
            .expect("the resend says why the upload was refused");
        assert_eq!(refusal.reason, reason);

        upload(&staging, &upload_key, b"not a replay");
        process_uploads(&db, &storage, &staging).await.unwrap();
        let reason: String = sqlx::query_scalar("SELECT refused_reason FROM replays")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(
            reason.contains("format 12"),
            "the latest reason is kept: {reason}"
        );
    }

    #[sqlx::test]
    async fn a_replay_whose_time_is_nan_is_refused(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        let time = header::parse(MAZE).unwrap().time.to_le_bytes();
        let at = MAZE
            .windows(time.len())
            .position(|window| window == time)
            .expect("the header holds the time");
        let mut file = MAZE.to_vec();
        file[at..at + time.len()].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(header::parse(&file).unwrap().time.is_nan());
        upload(&staging, &upload_key, &file);

        assert_eq!(
            process_uploads(&db, &storage, &staging)
                .await
                .unwrap()
                .refused,
            1
        );
        assert_eq!(keys(&storage), [""; 0], "nothing is stored");
    }

    #[sqlx::test]
    async fn the_player_map_and_track_must_match(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let mut other_player = maze_run("a");
        other_player["player"]["steamid64"] = json!("76561197960287930");
        let mut other_map = maze_run("b");
        other_map["map"] = json!("bhop_badges");
        other_map["player"]["steamid64"] = json!("76561197960287931");
        let mut bonus = maze_run("c");
        bonus["track"] = json!(1);

        for (run, expected) in [
            (other_player, "another player"),
            (other_map, "bhop_badges"),
            (bonus, "track"),
        ] {
            let upload_key = submit(&db, &key, &run).await;
            upload(&staging, &upload_key, MAZE);
            assert_eq!(
                process_uploads(&db, &storage, &staging)
                    .await
                    .unwrap()
                    .refused,
                1
            );
            let reason: String =
                sqlx::query_scalar("SELECT refused_reason FROM replays WHERE upload_key = $1")
                    .bind(&upload_key)
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert!(
                reason.contains(expected),
                "{reason} should mention {expected:?}"
            );
        }
    }

    #[sqlx::test]
    async fn unrequested_files_and_repeats_after_storing_are_discarded(db: PgPool) {
        let key = setup(&db).await;
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload_key = submit(&db, &key, &maze_run("a")).await;
        upload(&staging, &upload_key, MAZE);
        process_uploads(&db, &storage, &staging).await.unwrap();
        let stored = keys(&storage);

        upload(&staging, &upload_key, MAZE);
        upload(&staging, &format!("{UPLOAD_PREFIX}999-guess.replay"), MAZE);
        let processed = process_uploads(&db, &storage, &staging).await.unwrap();

        assert_eq!(
            processed,
            Processed {
                discarded: 2,
                ..Processed::default()
            }
        );
        assert_eq!(keys(&storage), stored, "only the stored replay is left");
    }
}
