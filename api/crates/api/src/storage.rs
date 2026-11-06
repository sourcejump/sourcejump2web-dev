//! Object storage over the S3 API (ADR 0006). Large files such as replays go straight from game servers to
//! storage through presigned links, so their bytes never pass through the API. Small files the API makes
//! itself, such as map images, it writes with the same signed requests, and it reads uploaded replays back
//! once to check and compress them (`replays/processing.rs`). Public files are read from
//! `SJ_S3_PUBLIC_URL`, where the bucket (or a CDN in front of it) serves them to browsers. Staff uploads land
//! in a second, private bucket first (`Staging`).

use std::{fmt::Write, time::Duration};

use axum::body::Bytes;
use futures_util::{
    StreamExt,
    stream::{self, BoxStream},
};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};

/// How long a signed request the API sends itself stays valid; it's used at once.
#[cfg(not(test))]
const REQUEST_LIFETIME: Duration = Duration::from_secs(60);

/// How long a request to storage may take, unless it says otherwise.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Reading a staged upload of hundreds of MB takes longer than an ordinary request.
#[cfg(not(test))]
const STAGED_READ_TIMEOUT: Duration = Duration::from_mins(5);

/// Storing a public file: viewer files run to about 256 MB, which at a slow 1 MB/s from the API's host to
/// storage takes four minutes and a bit. Small files finish long before, so the bound costs them nothing.
#[cfg(not(test))]
const PUT_TIMEOUT: Duration = Duration::from_mins(10);

/// Reading a whole object (`get`), which is only done for a stored replay (SJR) a download rebuilds its shavit
/// file from. An SJR is a compressed replay of at most 128 MB, so at worst a little over that: two minutes and a
/// bit at a slow 1 MB/s from storage to the API's host. Five minutes leaves room without letting a stuck read
/// hold a rebuild slot for long.
#[cfg(not(test))]
const GET_TIMEOUT: Duration = Duration::from_mins(5);

/// Passing a file on (`get_stream`): the body is read from storage only as fast as the client downloads it,
/// so this bounds the slowest download allowed. Half an hour lets a 128 MB replay through at 75 KB/s; a
/// download slower than that is cut off, and the client can start it again.
#[cfg(not(test))]
const STREAM_TIMEOUT: Duration = Duration::from_mins(30);

fn env_var(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} must be set"))
}

/// 128 random bits as hex, for object keys: the public bucket is readable by anyone who knows a key, so a key
/// that can't be guessed is found only through the API.
pub fn random_key_part() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the operating system's random source failed");
    bytes
        .iter()
        .fold(String::with_capacity(32), |mut hex, byte| {
            write!(hex, "{byte:02x}").expect("writing to a String can't fail");
            hex
        })
}

#[derive(Clone, Debug)]
pub struct Storage {
    bucket: Bucket,
    credentials: Credentials,
    /// Where public objects are read from, without a trailing slash.
    public_url: String,
    #[cfg_attr(test, allow(dead_code))]
    http: reqwest::Client,
    /// Tests keep objects in memory; nothing in tests talks to a storage server.
    #[cfg(test)]
    pub objects: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>>,
}

impl Storage {
    /// Reads `SJ_S3_ENDPOINT`, `SJ_S3_REGION`, `SJ_S3_BUCKET`, `SJ_S3_ACCESS_KEY_ID`,
    /// `SJ_S3_SECRET_ACCESS_KEY` and `SJ_S3_PUBLIC_URL`.
    pub fn from_env() -> Result<Self, String> {
        let public_url = env_var("SJ_S3_PUBLIC_URL")?;
        url::Url::parse(&public_url).map_err(|_| "SJ_S3_PUBLIC_URL must be a URL".to_owned())?;
        Self::bucket_from_env(&env_var("SJ_S3_BUCKET")?, &public_url)
    }

    /// One bucket at the endpoint, region and credentials both buckets share.
    fn bucket_from_env(bucket: &str, public_url: &str) -> Result<Self, String> {
        let endpoint = env_var("SJ_S3_ENDPOINT")?
            .parse()
            .map_err(|_| "SJ_S3_ENDPOINT must be a URL".to_owned())?;
        Self::new(
            endpoint,
            &env_var("SJ_S3_REGION")?,
            bucket,
            Credentials::new(
                env_var("SJ_S3_ACCESS_KEY_ID")?,
                env_var("SJ_S3_SECRET_ACCESS_KEY")?,
            ),
            public_url,
        )
    }

    fn new(
        endpoint: url::Url,
        region: &str,
        bucket: &str,
        credentials: Credentials,
        public_url: &str,
    ) -> Result<Self, String> {
        // Path-style URLs work with every candidate provider and with a local server on 127.0.0.1.
        let bucket = Bucket::new(
            endpoint,
            UrlStyle::Path,
            bucket.to_owned(),
            region.to_owned(),
        )
        .map_err(|error| format!("invalid S3 settings: {error}"))?;
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| format!("couldn't set up the storage client: {error}"))?;
        Ok(Self {
            bucket,
            credentials,
            public_url: public_url.trim_end_matches('/').to_owned(),
            http,
            #[cfg(test)]
            objects: std::sync::Arc::default(),
        })
    }

    /// A URL that lets whoever holds it upload one object under `object_key` until it expires.
    pub fn presign_put(&self, object_key: &str, valid_for: Duration) -> String {
        self.bucket
            .put_object(Some(&self.credentials), object_key)
            .sign(valid_for)
            .into()
    }

    /// Where browsers read a public object.
    pub fn public_url(&self, object_key: &str) -> String {
        format!("{}/{object_key}", self.public_url)
    }

    /// Stores a public file that never changes under its key, so browsers and CDNs may cache it for good. With a
    /// content encoding (such as `br`), browsers decode the file themselves as it arrives.
    // In tests these keep files in memory, so nothing is awaited there.
    #[cfg_attr(test, allow(clippy::unused_async, clippy::unused_async_trait_impl))]
    pub async fn put_immutable(
        &self,
        object_key: &str,
        content_type: &str,
        content_encoding: Option<&str>,
        bytes: Vec<u8>,
    ) -> Result<(), StorageError> {
        #[cfg(test)]
        {
            let _ = (content_type, content_encoding);
            self.objects
                .lock()
                .expect("not poisoned")
                .insert(object_key.to_owned(), bytes);
            Ok(())
        }
        #[cfg(not(test))]
        {
            let url = self.presign_put(object_key, REQUEST_LIFETIME);
            let mut request = self
                .http
                .put(url)
                .timeout(PUT_TIMEOUT)
                .header("content-type", content_type)
                .header("cache-control", "public, max-age=31536000, immutable");
            if let Some(encoding) = content_encoding {
                request = request.header("content-encoding", encoding);
            }
            let response = request.body(bytes).send().await?;
            check(response.status())
        }
    }

    /// Every object whose key starts with `prefix`, with its size, in key order.
    #[cfg_attr(test, allow(clippy::unused_async, clippy::unused_async_trait_impl))]
    pub async fn list(&self, prefix: &str) -> Result<Vec<StoredObject>, StorageError> {
        #[cfg(test)]
        {
            let objects = self.objects.lock().expect("not poisoned");
            let mut found: Vec<StoredObject> = objects
                .iter()
                .filter(|(key, _)| key.starts_with(prefix))
                .map(|(key, bytes)| StoredObject {
                    key: key.clone(),
                    size: bytes.len() as u64,
                })
                .collect();
            found.sort_by(|a, b| a.key.cmp(&b.key));
            Ok(found)
        }
        #[cfg(not(test))]
        {
            let mut found = Vec::new();
            let mut continuation = None;
            loop {
                let mut action = self.bucket.list_objects_v2(Some(&self.credentials));
                action.with_prefix(prefix);
                if let Some(token) = &continuation {
                    action.with_continuation_token(String::clone(token));
                }
                let url: String = action.sign(REQUEST_LIFETIME).into();
                let response = self.http.get(url).send().await?;
                check(response.status())?;
                let page =
                    rusty_s3::actions::ListObjectsV2::parse_response(&response.text().await?)
                        .map_err(|error| StorageError::Listing(error.to_string()))?;
                for object in page.contents {
                    // S3 always lists sizes, though rusty-s3 types them optional. Callers compare sizes to
                    // tell whether an object is already stored, so a missing one is an error, not 0.
                    let size = object.size.ok_or_else(|| {
                        StorageError::Listing(format!("no size for {}", object.key))
                    })?;
                    found.push(StoredObject {
                        key: object.key,
                        size,
                    });
                }
                match page.next_continuation_token {
                    Some(token) => continuation = Some(token),
                    None => return Ok(found),
                }
            }
        }
    }

    /// Reads a whole object. The caller checks its size first: this holds it all in memory.
    #[cfg_attr(test, allow(clippy::unused_async, clippy::unused_async_trait_impl))]
    pub async fn get(&self, object_key: &str) -> Result<Vec<u8>, StorageError> {
        #[cfg(test)]
        {
            self.objects
                .lock()
                .expect("not poisoned")
                .get(object_key)
                .cloned()
                .ok_or(StorageError::Status(404))
        }
        #[cfg(not(test))]
        {
            let url: String = self
                .bucket
                .get_object(Some(&self.credentials), object_key)
                .sign(REQUEST_LIFETIME)
                .into();
            let response = self.http.get(url).timeout(GET_TIMEOUT).send().await?;
            check(response.status())?;
            Ok(response.bytes().await?.to_vec())
        }
    }

    /// Reads an object as it arrives, to pass a large file on without holding it all. Also says its size,
    /// when the storage server does.
    #[cfg_attr(test, allow(clippy::unused_async, clippy::unused_async_trait_impl))]
    pub async fn get_stream(
        &self,
        object_key: &str,
    ) -> Result<(Option<u64>, BoxStream<'static, Result<Bytes, StorageError>>), StorageError> {
        #[cfg(test)]
        {
            let bytes = self.get(object_key).await?;
            let size = bytes.len() as u64;
            Ok((
                Some(size),
                stream::once(async { Ok(Bytes::from(bytes)) }).boxed(),
            ))
        }
        #[cfg(not(test))]
        {
            let url: String = self
                .bucket
                .get_object(Some(&self.credentials), object_key)
                .sign(REQUEST_LIFETIME)
                .into();
            let response = self.http.get(url).timeout(STREAM_TIMEOUT).send().await?;
            check(response.status())?;
            let size = response.content_length();
            // Ends after the first error, which the receiver sees as a cut-off body.
            let chunks = stream::unfold(Some(response), |response| async move {
                let mut response = response?;
                match response.chunk().await {
                    Ok(Some(chunk)) => Some((Ok(chunk), Some(response))),
                    Ok(None) => None,
                    Err(error) => Some((Err(error.into()), None)),
                }
            });
            Ok((size, chunks.boxed()))
        }
    }

    /// Removes a file. Removing one that isn't there succeeds.
    #[cfg_attr(test, allow(clippy::unused_async, clippy::unused_async_trait_impl))]
    pub async fn delete(&self, object_key: &str) -> Result<(), StorageError> {
        #[cfg(test)]
        {
            self.objects
                .lock()
                .expect("not poisoned")
                .remove(object_key);
            Ok(())
        }
        #[cfg(not(test))]
        {
            let url: String = self
                .bucket
                .delete_object(Some(&self.credentials), object_key)
                .sign(REQUEST_LIFETIME)
                .into();
            let response = self.http.delete(url).send().await?;
            check(response.status())
        }
    }

    /// Signs with made-up credentials and keeps objects in memory.
    #[cfg(test)]
    pub fn for_tests() -> Self {
        Self::new(
            "http://127.0.0.1:3900".parse().unwrap(),
            "test",
            "test-bucket",
            Credentials::new("test-key", "test-secret"),
            "https://files.sourcejump.test",
        )
        .unwrap()
    }
}

/// The private bucket (`SJ_S3_STAGING_BUCKET`) that staff uploads land in before the API checks them. It has
/// no public address, so whatever a holder of an upload link puts there is never served from SourceJump's
/// domain: only bytes the API read and checked go on to the public bucket. Uploads skip the API because
/// Cloudflare's proxy in front of it refuses request bodies over 100 MB. A lifecycle rule on the bucket
/// deletes what's left after a day (`docs/deploy.md`).
#[derive(Clone, Debug)]
pub struct Staging(Storage);

/// What a staged upload's key holds.
#[derive(Debug, PartialEq, Eq)]
pub enum Staged {
    Missing,
    /// Over the reader's limit; not read past it.
    TooLarge,
    Bytes(Vec<u8>),
}

impl Staging {
    /// Reads `SJ_S3_STAGING_BUCKET`, and the endpoint, region and credentials as `Storage::from_env` does.
    pub fn from_env() -> Result<Self, String> {
        // Never served, so it has no public address.
        Storage::bucket_from_env(&env_var("SJ_S3_STAGING_BUCKET")?, "").map(Self)
    }

    /// A URL that lets whoever holds it upload one object under `object_key` until it expires.
    pub fn presign_put(&self, object_key: &str, valid_for: Duration) -> String {
        self.0.presign_put(object_key, valid_for)
    }

    /// Reads an upload of at most `max_bytes`, stopping as soon as it's longer: the uploader chose its size,
    /// and may even replace it while it's read.
    #[cfg_attr(test, allow(clippy::unused_async, clippy::unused_async_trait_impl))]
    pub async fn read(&self, object_key: &str, max_bytes: usize) -> Result<Staged, StorageError> {
        #[cfg(test)]
        {
            Ok(
                match self.0.objects.lock().expect("not poisoned").get(object_key) {
                    None => Staged::Missing,
                    Some(bytes) if bytes.len() > max_bytes => Staged::TooLarge,
                    Some(bytes) => Staged::Bytes(bytes.clone()),
                },
            )
        }
        #[cfg(not(test))]
        {
            let url: String = self
                .0
                .bucket
                .get_object(Some(&self.0.credentials), object_key)
                .sign(REQUEST_LIFETIME)
                .into();
            let mut response = self
                .0
                .http
                .get(url)
                .timeout(STAGED_READ_TIMEOUT)
                .send()
                .await?;
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                return Ok(Staged::Missing);
            }
            check(response.status())?;
            if response
                .content_length()
                .is_some_and(|length| length > max_bytes as u64)
            {
                return Ok(Staged::TooLarge);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await? {
                if bytes.len() + chunk.len() > max_bytes {
                    return Ok(Staged::TooLarge);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(Staged::Bytes(bytes))
        }
    }

    /// The uploads under `prefix` that have finished, with the sizes they had when listed.
    pub async fn list(&self, prefix: &str) -> Result<Vec<StoredObject>, StorageError> {
        self.0.list(prefix).await
    }

    /// Removes an upload. Removing one that isn't there succeeds.
    pub async fn delete(&self, object_key: &str) -> Result<(), StorageError> {
        self.0.delete(object_key).await
    }

    /// Signs with made-up credentials and keeps objects in memory, apart from `Storage::for_tests`'s.
    #[cfg(test)]
    pub fn for_tests() -> Self {
        Self(
            Storage::new(
                "http://127.0.0.1:3900".parse().unwrap(),
                "test",
                "test-staging",
                Credentials::new("test-key", "test-secret"),
                "",
            )
            .unwrap(),
        )
    }

    /// The uploads, as a test puts them there or finds them left.
    #[cfg(test)]
    pub fn objects(&self) -> std::sync::MutexGuard<'_, std::collections::HashMap<String, Vec<u8>>> {
        self.0.objects.lock().expect("not poisoned")
    }
}

#[cfg(not(test))]
fn check(status: reqwest::StatusCode) -> Result<(), StorageError> {
    if status.is_success() {
        Ok(())
    } else {
        Err(StorageError::Status(status.as_u16()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredObject {
    pub key: String,
    /// Bytes.
    pub size: u64,
}

#[derive(Debug)]
pub enum StorageError {
    Request(reqwest::Error),
    /// The storage server refused, with this HTTP status.
    Status(u16),
    /// The storage server's object listing couldn't be read.
    #[cfg_attr(test, allow(dead_code))]
    Listing(String),
}

impl From<reqwest::Error> for StorageError {
    fn from(error: reqwest::Error) -> Self {
        Self::Request(error)
    }
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Request(error) => write!(f, "storage request failed: {error}"),
            Self::Status(status) => write!(f, "storage answered {status}"),
            Self::Listing(error) => write!(f, "storage sent a listing that can't be read: {error}"),
        }
    }
}

impl std::error::Error for StorageError {}
