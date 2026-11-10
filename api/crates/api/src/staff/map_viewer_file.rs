//! A map's file for the replay viewer and zone editor (`maps/viewer_file.rs`), uploaded by staff who packed it
//! in their browser or with `sj-pack` (`manage_maps` or `manage_zones`: zoning a map needs its file). Packing
//! takes minutes of CPU, which staff machines spare better than the API's server; checking an upload takes
//! seconds (7.5 for a 180 MB packed map on a desktop), well inside Cloudflare's 100-second limit on a response.
//!
//! Staff upload in two steps: ask for a link, upload the packed map to it, then name the upload so the API
//! checks it. The link points into the private staging bucket (`storage::Staging`), never at a public file;
//! only the bytes the API checked are stored for visitors.
//!
//! The file is stored before it's recorded, so a map never points at a missing file, and the file it replaces
//! is deleted after.

use std::time::Duration;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use utoipa::ToSchema;

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction},
    maps::map_name,
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::{self, MapName},
    players::{SteamId64, privileges::Privilege},
    storage::{Staged, Staging, Storage, random_key_part},
};

/// How long an upload link works. Staff upload right after asking; storage checks the time when an upload
/// starts, so a slow upload that started in time still finishes.
const UPLOAD_LINK_LIFETIME: Duration = Duration::from_mins(15);

/// Packed files above this are refused. The largest map in daf's sample, 180 MB, packs to 163 MB: it keeps its
/// pakfile LZMA-compressed, which brotli can't shrink further. The packer refuses to make larger ones.
pub const MAX_UPLOAD_BYTES: usize = viewer_pack::MAX_PACKED_BYTES;

/// Checks a packed map and makes it the map's viewer file, replacing any earlier one. Adds the map if
/// SourceJump hasn't seen it, so a new map can be zoned before its first run.
pub async fn upload_viewer_file(
    db: &PgPool,
    storage: &Storage,
    actor: Option<SteamId64>,
    map: &MapName,
    file: Vec<u8>,
) -> Result<(), ChangeError> {
    // Decoding and re-stripping a large map takes seconds: off the async workers.
    let (checked, file) = tokio::task::spawn_blocking(move || {
        viewer_pack::check(&file).map(|checked| (checked, file))
    })
    .await
    .map_err(|error| ChangeError::Invalid(format!("the file couldn't be checked: {error}")))?
    .map_err(ChangeError::Invalid)?;
    let object_key = format!("maps/viewer/{}-{}.bsp", map.as_str(), checked.hash);
    let stored_bytes = i64::try_from(file.len()).expect("under the upload limit");
    storage
        .put_immutable(&object_key, "application/octet-stream", Some("br"), file)
        .await
        .map_err(ChangeError::Storage)?;

    let mut tx = db.begin().await?;
    let map_id = maps::id_for(&mut tx, map).await?;
    // Locked, so of two uploads at once the second waits and then deletes the file the first stored.
    let replaced = sqlx::query_scalar!(
        "SELECT object_key FROM map_viewer_files WHERE map_id = $1 FOR UPDATE",
        map_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO map_viewer_files (map_id, object_key, stripped_bytes, stored_bytes, made_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (map_id) DO UPDATE
            SET object_key = $2, stripped_bytes = $3, stored_bytes = $4, made_at = now()
        "#,
        map_id,
        object_key,
        i64::try_from(checked.stripped_bytes).expect("under the map limit"),
        stored_bytes
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::UploadViewerFile,
        target: map.as_str(),
        reason: None,
        detail: json!({ "file": object_key, "bytes": stored_bytes }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    // Deleted only once nothing points at it; a failure here leaves an unused file, never a broken link.
    if let Some(old) = replaced.filter(|old| *old != object_key) {
        storage.delete(&old).await.map_err(ChangeError::Storage)?;
    }
    Ok(())
}

/// A random staging key for an upload to `map`, so only the staff member given its link knows it.
fn upload_key(map: &MapName) -> String {
    format!("viewer/{}-{}", map.as_str(), random_key_part())
}

/// Whether `upload_key` could have made `key` for `map`, so a request can't have the API read any other
/// object from staging.
fn is_upload_key(map: &MapName, key: &str) -> bool {
    key.strip_prefix("viewer/")
        .and_then(|rest| rest.strip_prefix(map.as_str()))
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|random| {
            random.len() == 32
                && random
                    .bytes()
                    .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        })
}

/// Checks a packed map uploaded to staging and makes it the map's viewer file, as `upload_viewer_file`. A
/// checked upload is deleted, passed or refused; one that couldn't be read or stored stays, so naming it
/// again retries.
pub async fn store_upload(
    db: &PgPool,
    storage: &Storage,
    staging: &Staging,
    actor: Option<SteamId64>,
    map: &MapName,
    upload: &str,
) -> Result<(), ChangeError> {
    if !is_upload_key(map, upload) {
        return Err(ChangeError::Invalid(
            "that isn't an upload SourceJump gave a link for, for this map".to_owned(),
        ));
    }
    let stored = match staging
        .read(upload, MAX_UPLOAD_BYTES)
        .await
        .map_err(ChangeError::Storage)?
    {
        Staged::Missing => {
            return Err(ChangeError::Invalid(
                "nothing was uploaded to that link; upload the file again".to_owned(),
            ));
        }
        Staged::TooLarge => Err(ChangeError::Invalid(format!(
            "the packed map is over {} MB",
            MAX_UPLOAD_BYTES >> 20
        ))),
        Staged::Bytes(file) => upload_viewer_file(db, storage, actor, map, file).await,
    };
    if matches!(stored, Ok(()) | Err(ChangeError::Invalid(_)))
        && let Err(error) = staging.delete(upload).await
    {
        // Harmless: the staging bucket's lifecycle rule deletes it within a day.
        tracing::warn!(%error, "a checked upload couldn't be deleted from staging");
    }
    stored
}

/// A map's stored viewer file, for the bulk upload to tell which maps it can skip.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StoredViewerFile {
    pub map: String,
    /// The stripped map's hash, as the packer gives it: the same hash means the same file.
    pub hash: String,
    /// The packed file's size.
    pub bytes: i64,
}

/// A map with runs but no viewer file, so none of its replays can be watched yet.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MissingViewerFile {
    pub map: String,
    /// Its valid runs.
    pub runs: i64,
    /// Its stored replays: the ones waiting on the file.
    pub replays: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StoredViewerFiles {
    /// Every map that has a viewer file, by name.
    pub files: Vec<StoredViewerFile>,
    /// Every map with a valid run and no viewer file, most stored replays first, then most runs.
    pub missing: Vec<MissingViewerFile>,
}

/// Every map's stored viewer file, and the maps with runs that still need one, for staff uploading many at
/// once.
#[utoipa::path(
    get,
    path = "/v1/staff/viewer-files",
    tag = "staff",
    responses(
        (status = OK, body = StoredViewerFiles),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps or manage_zones", body = ErrorBody),
    ),
)]
pub async fn list_viewer_files(
    State(state): State<AppState>,
    staff: Staff,
) -> Result<Json<StoredViewerFiles>, ApiError> {
    staff.require_any(&[Privilege::ManageMaps, Privilege::ManageZones])?;
    let rows = sqlx::query!(
        r#"
        SELECT m.name, f.object_key AS "object_key!", f.stored_bytes AS "stored_bytes!"
        FROM map_viewer_files f JOIN maps m ON m.id = f.map_id
        WHERE f.object_key IS NOT NULL
        ORDER BY m.name
        "#
    )
    .fetch_all(&state.db)
    .await?;
    let files = rows
        .into_iter()
        .map(|row| StoredViewerFile {
            hash: key_hash(&row.object_key).to_owned(),
            map: row.name,
            bytes: row.stored_bytes,
        })
        .collect();
    // Invalidated runs don't count: their replays aren't shown, so a map with only those needs no file yet.
    let missing = sqlx::query_as!(
        MissingViewerFile,
        r#"
        SELECT m.name AS map, count(*) AS "runs!", count(rp.stored_key) AS "replays!"
        FROM runs r
        JOIN maps m ON m.id = r.map_id
        LEFT JOIN replays rp ON rp.run_id = r.id
        WHERE r.invalidated_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM map_viewer_files f WHERE f.map_id = m.id AND f.object_key IS NOT NULL
          )
        GROUP BY m.name
        ORDER BY 3 DESC, 2 DESC, m.name
        "#
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(StoredViewerFiles { files, missing }))
}

/// The hash in a key `upload_viewer_file` made: `maps/viewer/{map}-{hash}.bsp`.
fn key_hash(key: &str) -> &str {
    let name = key.strip_suffix(".bsp").unwrap_or(key);
    name.rsplit_once('-').map_or("", |(_, hash)| hash)
}

/// Where to upload a packed map, and the name to confirm it by.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ViewerFileUploadLink {
    /// Name the upload by this once it's done (`PUT …/viewer-file`).
    pub upload: String,
    /// Send the packed map with an HTTP `PUT` to this URL, without credentials. Keep it to yourself until
    /// it expires: whoever holds it can upload.
    pub upload_url: String,
    /// After this the URL refuses new uploads; ask for another.
    pub expires_at: DateTime<Utc>,
}

/// A packed map uploaded to a link from `POST …/viewer-file/uploads`.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ViewerFileUpload {
    /// The link's `upload`.
    pub upload: String,
}

/// Get a link to upload a packed map to (the `.bsp` stripped for the viewer by SourceJump's packer,
/// brotli-compressed, up to 256 MB). The upload goes to private storage; nothing is stored for visitors until
/// it's named in `PUT …/viewer-file`.
#[utoipa::path(
    post,
    path = "/v1/staff/maps/{map}/viewer-file/uploads",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    responses(
        (status = OK, description = "Where to upload", body = ViewerFileUploadLink),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps or manage_zones, from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name", body = ErrorBody),
    ),
)]
pub async fn post_viewer_file_upload(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
) -> Result<Json<ViewerFileUploadLink>, ApiError> {
    staff.require_any(&[Privilege::ManageMaps, Privilege::ManageZones])?;
    let upload = upload_key(&map_name(map)?);
    Ok(Json(ViewerFileUploadLink {
        upload_url: state.staging.presign_put(&upload, UPLOAD_LINK_LIFETIME),
        upload,
        expires_at: Utc::now()
            + TimeDelta::from_std(UPLOAD_LINK_LIFETIME).expect("minutes fit in a TimeDelta"),
    }))
}

/// Set the map's viewer file from an upload: SourceJump checks that stripping it again would change nothing,
/// then serves it as is. Adds a map SourceJump hasn't seen.
#[utoipa::path(
    put,
    path = "/v1/staff/maps/{map}/viewer-file",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    request_body = ViewerFileUpload,
    responses(
        (status = NO_CONTENT, description = "Stored"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps or manage_zones, from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name, nothing uploaded, over 256 MB, or not a packed map", body = ErrorBody),
    ),
)]
pub async fn put_viewer_file(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
    Json(body): Json<ViewerFileUpload>,
) -> Result<StatusCode, ApiError> {
    staff.require_any(&[Privilege::ManageMaps, Privilege::ManageZones])?;
    store_upload(
        &state.db,
        &state.storage,
        &state.staging,
        Some(staff.steamid64),
        &map_name(map)?,
        &body.upload,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use sqlx::PgPool;

    use super::{
        StoredViewerFiles, ViewerFileUploadLink, store_upload, upload_key, upload_viewer_file,
    };
    use crate::{
        app::AppState,
        auth::sessions,
        maps::{MapName, viewer_file::of_map},
        players::privileges::Privilege,
        runs::tests::{run, setup},
        staff::{ChangeError, maps::tests::session},
        storage::{Staging, Storage},
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287930";

    /// The smallest map, packed as the browser would.
    fn packed(version: u8) -> Vec<u8> {
        let mut bsp = vec![0u8; 8 + 64 * 16 + 4];
        bsp[..4].copy_from_slice(b"VBSP");
        bsp[4] = version;
        viewer_pack::pack(&bsp, |_| {}).unwrap().file
    }

    fn map() -> MapName {
        MapName::try_from("bhop_new".to_owned()).unwrap()
    }

    #[sqlx::test]
    async fn an_upload_adds_the_map_and_replaces_the_old_file(db: PgPool) {
        let storage = Storage::for_tests();
        upload_viewer_file(&db, &storage, None, &map(), packed(20))
            .await
            .unwrap();
        let map_id: i64 = sqlx::query_scalar("SELECT id FROM maps WHERE name = 'bhop_new'")
            .fetch_one(&db)
            .await
            .unwrap();
        let first = of_map(&db, &storage, map_id).await.unwrap().unwrap();
        upload_viewer_file(&db, &storage, None, &map(), packed(19))
            .await
            .unwrap();
        let second = of_map(&db, &storage, map_id).await.unwrap().unwrap();

        assert_ne!(first.url, second.url, "a changed map gets a new key");
        assert_eq!(
            storage.objects.lock().unwrap().len(),
            1,
            "the old file is deleted"
        );
        let logged: Vec<String> =
            sqlx::query_scalar("SELECT action FROM staff_log WHERE target = 'bhop_new'")
                .fetch_all(&db)
                .await
                .unwrap();
        assert_eq!(logged, ["upload_viewer_file", "upload_viewer_file"]);
    }

    #[sqlx::test]
    async fn a_file_that_isnt_packed_is_refused_and_keeps_the_old_one(db: PgPool) {
        let storage = Storage::for_tests();
        upload_viewer_file(&db, &storage, None, &map(), packed(20))
            .await
            .unwrap();

        let refused = upload_viewer_file(&db, &storage, None, &map(), b"nope".to_vec()).await;

        assert!(matches!(refused, Err(ChangeError::Invalid(_))));
        assert_eq!(storage.objects.lock().unwrap().len(), 1);
    }

    #[sqlx::test]
    async fn a_checked_upload_is_stored_and_leaves_staging(db: PgPool) {
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload = upload_key(&map());
        staging.objects().insert(upload.clone(), packed(20));

        store_upload(&db, &storage, &staging, None, &map(), &upload)
            .await
            .unwrap();

        assert!(staging.objects().is_empty());
        assert_eq!(storage.objects.lock().unwrap().len(), 1);
    }

    #[sqlx::test]
    async fn a_refused_upload_leaves_staging_and_stores_nothing(db: PgPool) {
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let upload = upload_key(&map());
        staging.objects().insert(upload.clone(), b"nope".to_vec());

        let refused = store_upload(&db, &storage, &staging, None, &map(), &upload).await;

        assert!(matches!(refused, Err(ChangeError::Invalid(_))));
        assert!(staging.objects().is_empty());
        assert!(storage.objects.lock().unwrap().is_empty());
    }

    #[sqlx::test]
    async fn only_this_maps_upload_keys_are_read(db: PgPool) {
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let other = upload_key(&MapName::try_from("bhop_other".to_owned()).unwrap());
        let made_up = format!("viewer/{}-../../maps/viewer/x", map().as_str());
        for key in [
            other.as_str(),
            made_up.as_str(),
            "viewer/bhop_new",
            "maps/viewer/bhop_new.bsp",
        ] {
            staging.objects().insert(key.to_owned(), packed(20));
            let refused = store_upload(&db, &storage, &staging, None, &map(), key).await;
            assert!(matches!(refused, Err(ChangeError::Invalid(_))), "{key}");
        }
        assert_eq!(staging.objects().len(), 4, "refused before reading");
        assert!(storage.objects.lock().unwrap().is_empty());
    }

    #[sqlx::test]
    async fn naming_an_upload_that_isnt_there_is_refused(db: PgPool) {
        let (storage, staging) = (Storage::for_tests(), Staging::for_tests());
        let refused =
            store_upload(&db, &storage, &staging, None, &map(), &upload_key(&map())).await;
        assert!(matches!(refused, Err(ChangeError::Invalid(_))));
    }

    async fn send(
        state: &AppState,
        method: &str,
        path: &str,
        token: &str,
        body: Body,
    ) -> TestResponse {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("content-type", "application/json")
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(body)
            .unwrap();
        test_client::send_to(state.clone(), request).await
    }

    #[sqlx::test]
    async fn staff_upload_through_a_link_then_name_the_upload(db: PgPool) {
        let state = AppState::for_tests(db.clone());
        let zones = session(&db, STAFF, &[Privilege::ManageZones]).await;
        let path = "/v1/staff/maps/bhop_new/viewer-file";

        let response = send(
            &state,
            "POST",
            &format!("{path}/uploads"),
            &zones,
            Body::empty(),
        )
        .await;
        assert_eq!(response.status, 200);
        let link: ViewerFileUploadLink = response.json();
        assert!(
            link.upload_url.contains("test-staging/")
                && link.upload_url.contains("X-Amz-Signature=")
        );
        state
            .staging
            .objects()
            .insert(link.upload.clone(), packed(20));

        let body = serde_json::json!({ "upload": link.upload }).to_string();
        assert_eq!(
            send(&state, "PUT", path, &zones, Body::from(body))
                .await
                .status,
            204
        );
        assert_eq!(state.storage.objects.lock().unwrap().len(), 1);
    }

    #[sqlx::test]
    async fn stored_files_are_listed_with_their_hash(db: PgPool) {
        let state = AppState::for_tests(db.clone());
        upload_viewer_file(&db, &state.storage, None, &map(), packed(20))
            .await
            .unwrap();
        let maps = session(&db, STAFF, &[Privilege::ManageMaps]).await;
        let keys = session(&db, "76561197960287931", &[Privilege::ManageKeys]).await;

        let response = send(
            &state,
            "GET",
            "/v1/staff/viewer-files",
            &maps,
            Body::empty(),
        )
        .await;
        assert_eq!(response.status, 200);
        let listed: StoredViewerFiles = response.json();
        let hash = viewer_pack::check(&packed(20)).unwrap().hash;
        assert_eq!(listed.files.len(), 1);
        assert_eq!(
            (listed.files[0].map.as_str(), listed.files[0].hash.as_str()),
            ("bhop_new", hash.as_str())
        );
        let refused = send(
            &state,
            "GET",
            "/v1/staff/viewer-files",
            &keys,
            Body::empty(),
        )
        .await;
        assert_eq!(refused.status, 403);
    }

    #[sqlx::test]
    async fn maps_with_runs_and_no_file_are_listed_as_missing(db: PgPool) {
        let state = AppState::for_tests(db.clone());
        let key = setup(&db).await;
        // Two runs on bhop_badges, one with a stored replay; one run on bhop_other, invalidated.
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("b", 29.0)).await;
        sqlx::query(
            "UPDATE replays SET stored_key = 'replays/1.sjr', stored_at = now(), raw_bytes = 1, stored_bytes = 1
             WHERE run_id = (SELECT min(run_id) FROM replays)",
        )
        .execute(&db)
        .await
        .unwrap();
        let mut other = run("c", 40.0);
        other["map"] = "bhop_other".into();
        test_client::post(&db, "/v1/runs", Some(&key), &other).await;
        sqlx::query(
            "WITH entry AS (
                 INSERT INTO staff_log (action, target, reason) VALUES ('invalidate_run', 'x', 'x') RETURNING id
             )
             UPDATE runs SET invalidated_at = now(), invalidated_by = (SELECT id FROM entry)
             WHERE map_id = (SELECT id FROM maps WHERE name = 'bhop_other')",
        )
        .execute(&db)
        .await
        .unwrap();
        let maps = session(&db, STAFF, &[Privilege::ManageMaps]).await;
        let list = |state: AppState, token: String| async move {
            let response = send(
                &state,
                "GET",
                "/v1/staff/viewer-files",
                &token,
                Body::empty(),
            )
            .await;
            response.json::<StoredViewerFiles>().missing
        };

        let missing = list(state.clone(), maps.clone()).await;
        assert_eq!(missing.len(), 1);
        assert_eq!(
            (missing[0].map.as_str(), missing[0].runs, missing[0].replays),
            ("bhop_badges", 2, 1)
        );

        let badges = MapName::try_from("bhop_badges".to_owned()).unwrap();
        upload_viewer_file(&db, &state.storage, None, &badges, packed(20))
            .await
            .unwrap();
        assert!(list(state, maps).await.is_empty());
    }

    #[sqlx::test]
    async fn uploading_needs_manage_maps_or_manage_zones(db: PgPool) {
        let state = AppState::for_tests(db.clone());
        let keys = session(&db, STAFF, &[Privilege::ManageKeys]).await;
        let path = "/v1/staff/maps/bhop_new/viewer-file";
        let upload = upload_key(&map());
        state.staging.objects().insert(upload.clone(), packed(20));
        let body = serde_json::json!({ "upload": upload }).to_string();

        assert_eq!(
            send(
                &state,
                "POST",
                &format!("{path}/uploads"),
                &keys,
                Body::empty()
            )
            .await
            .status,
            403
        );
        assert_eq!(
            send(&state, "PUT", path, &keys, Body::from(body))
                .await
                .status,
            403
        );
        assert_eq!(state.staging.objects().len(), 1, "left unread");
    }
}
