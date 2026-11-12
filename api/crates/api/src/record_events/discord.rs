//! The Discord record feeds: new world records, or every new personal best, posted to Discord channels through
//! webhooks. A feed is one channel, narrowed by style and tier range as its config says.
//!
//! Each feed reads the record events like any server that follows them, on its own task and from its own cursor
//! in the database, so a restart picks up where it stopped and a slow or broken channel holds back only itself.
//! Which records go where is config, not policy: a JSON file named by `SJ_DISCORD_FEEDS` lists the feeds, and the
//! webhook URLs in it are secrets. Without the file nothing is posted.
//!
//! A post is sent before it's marked done, so a crash in between can post a record twice; never zero times.
//! Discord being down holds a feed back until it answers. A post Discord refuses for good (the webhook was
//! deleted, or it won't take the message) is skipped with an error in the log.

pub(crate) mod post;

use std::{path::Path, time::Duration};

use serde::Deserialize;
use sqlx::{PgConnection, PgPool};
use url::Url;

use super::{Cursor, Kind, PAGE_SIZE, RecordEvent, caught_up, page, stream::Wake};
use crate::storage::Storage;

/// How often a feed looks for records it wasn't woken for, as open record streams do.
const LOOK_AGAIN: Duration = Duration::from_secs(30);
/// How long to wait after Discord or the database failed before trying again.
const RETRY: Duration = Duration::from_secs(60);

/// One channel's feed, as written in the config file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Feed {
    /// Shown in logs instead of the webhook, and keys the feed's cursor and what it posted. Renaming a feed
    /// makes it a new one, starting from now.
    pub name: String,
    #[serde(default)]
    pub records: Records,
    /// A style key from the ruleset. Left out: every style.
    #[serde(default)]
    pub style: Option<String>,
    /// The tier range this feed takes, both ends included. Leave both out for every map.
    #[serde(default)]
    pub min_tier: Option<i16>,
    #[serde(default)]
    pub max_tier: Option<i16>,
    /// Whether maps without a tier come here when a tier range is set.
    #[serde(default)]
    pub untiered: bool,
    /// Whether bonus tracks come here too, not only main tracks. Their own tier is what the range is matched to.
    #[serde(default)]
    pub bonuses: bool,
    /// The channel webhook's URL. A secret: anyone holding it can post in the channel.
    pub webhook: String,
}

/// Which records a feed posts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Records {
    /// New world records only.
    #[default]
    WorldRecords,
    /// Every new personal best, world records included.
    PersonalBests,
}

impl Feed {
    /// Whether an event is worth looking at, before the record is read for its tier.
    fn may_take(&self, event: &RecordEvent) -> bool {
        let rank_fits = match self.records {
            // Rank 1 now: a record beaten again by the time it's read isn't posted.
            Records::WorldRecords => event.rank == Some(1),
            Records::PersonalBests => event.rank.is_some(),
        };
        event.kind == Kind::Run
            && rank_fits
            && (event.track == 0 || self.bonuses)
            && self
                .style
                .as_ref()
                .is_none_or(|style| *style == event.style)
    }

    fn takes_tier(&self, tier: Option<i16>) -> bool {
        if self.min_tier.is_none() && self.max_tier.is_none() {
            return true;
        }
        tier.map_or(self.untiered, |tier| {
            self.min_tier.is_none_or(|min| tier >= min)
                && self.max_tier.is_none_or(|max| tier <= max)
        })
    }
}

/// Reads the feeds from the file `SJ_DISCORD_FEEDS` names; an empty list when it's unset.
pub fn feeds_from_env() -> Result<Vec<Feed>, String> {
    let Ok(path) = std::env::var("SJ_DISCORD_FEEDS") else {
        return Ok(Vec::new());
    };
    read_feeds(Path::new(&path))
}

fn read_feeds(path: &Path) -> Result<Vec<Feed>, String> {
    let text =
        std::fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let feeds: Vec<Feed> =
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
    for (i, feed) in feeds.iter().enumerate() {
        if feeds[..i].iter().any(|other| other.name == feed.name) {
            return Err(format!(
                "{}: two feeds are named {:?}",
                path.display(),
                feed.name
            ));
        }
        // Error messages carry the name, never the URL.
        let scheme = Url::parse(&feed.webhook).map(|url| url.scheme().to_owned());
        if !matches!(scheme.as_deref(), Ok("https" | "http")) {
            return Err(format!(
                "{}: feed {:?} needs an http(s) webhook",
                path.display(),
                feed.name
            ));
        }
    }
    Ok(feeds)
}

/// Where a post's links and pictures point.
#[derive(Clone)]
pub struct Links {
    pub public_url: Url,
    pub storage: Storage,
}

/// Starts one task per feed, each posting for as long as the API runs.
pub fn start(db: &PgPool, feeds: Vec<Feed>, links: &Links, wake: &Wake) {
    if feeds.is_empty() {
        tracing::info!("no Discord feeds configured (SJ_DISCORD_FEEDS); records aren't posted");
        return;
    }
    let http = http_client();
    for feed in feeds {
        tokio::spawn(run(
            db.clone(),
            http.clone(),
            feed,
            links.clone(),
            wake.clone(),
        ));
    }
}

/// The client every Discord feed posts with.
pub(crate) fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("SourceJump (sourcejump.net)")
        .build()
        .expect("the HTTP client's settings are valid")
}

/// Woken when record events commit, and every 30 s in case a wake was missed.
async fn run(db: PgPool, http: reqwest::Client, feed: Feed, links: Links, mut wake: Wake) {
    loop {
        let wait = match post_new_records(&db, &http, &feed, &links).await {
            Ok(()) => LOOK_AGAIN,
            Err(error) => {
                tracing::warn!(feed = %feed.name, %error, "Discord feed held back; trying again later");
                RETRY
            }
        };
        tokio::select! {
            changed = wake.changed() => if changed.is_err() {
                // The API is shutting down.
                return;
            },
            () = tokio::time::sleep(wait) => {}
        }
    }
}

#[derive(Debug)]
pub(crate) enum FeedError {
    Database(sqlx::Error),
    /// Discord didn't answer, or answered that it can't take posts right now.
    Unavailable(String),
}

impl std::fmt::Display for FeedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(f, "database: {error}"),
            Self::Unavailable(error) => write!(f, "Discord: {error}"),
        }
    }
}

impl From<sqlx::Error> for FeedError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

/// Posts every record for this feed since its cursor, moving the cursor forward page by page.
async fn post_new_records(
    db: &PgPool,
    http: &reqwest::Client,
    feed: &Feed,
    links: &Links,
) -> Result<(), FeedError> {
    let max_rank = match feed.records {
        Records::WorldRecords => 1,
        Records::PersonalBests => i64::MAX,
    };
    let mut conn = db.acquire().await?;
    let mut after = saved_cursor(&mut conn, &feed.name).await?;
    loop {
        let (events, next) = page(&mut conn, after, max_rank).await?;
        let wanted: Vec<&RecordEvent> = events.iter().filter(|e| feed.may_take(e)).collect();
        if !wanted.is_empty() {
            post::post(&mut conn, http, feed, links, &wanted).await?;
        }
        save_cursor(&mut conn, &feed.name, next).await?;
        after = next;
        if i64::try_from(events.len()) != Ok(PAGE_SIZE) {
            return Ok(());
        }
    }
}

/// Where the feed stopped. The first time, that's now: records from before the feed existed aren't posted.
async fn saved_cursor(conn: &mut PgConnection, feed: &str) -> Result<Cursor, sqlx::Error> {
    let saved = sqlx::query!(
        "SELECT tx, id FROM discord_feed_cursors WHERE feed = $1",
        feed
    )
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(row) = saved {
        return Ok(Cursor {
            tx: row.tx,
            id: row.id,
        });
    }
    let now = caught_up(conn).await?;
    save_cursor(conn, feed, now).await?;
    Ok(now)
}

async fn save_cursor(
    conn: &mut PgConnection,
    feed: &str,
    cursor: Cursor,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO discord_feed_cursors (feed, tx, id) VALUES ($1, $2, $3)
         ON CONFLICT (feed) DO UPDATE SET tx = excluded.tx, id = excluded.id",
        feed,
        cursor.tx,
        cursor.id
    )
    .execute(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{Json, Router, routing::post};
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use url::Url;

    use super::{Feed, Links, Records, post_new_records, read_feeds};
    use crate::{
        runs::{
            RunAccepted,
            tests::{run, setup},
        },
        staff::runs::{invalidate_run, restore_run},
        storage::Storage,
        test_client,
    };

    fn feed(name: &str, records: Records, webhook: &Url) -> Feed {
        Feed {
            name: name.to_owned(),
            records,
            style: Some("normal".to_owned()),
            min_tier: None,
            max_tier: None,
            untiered: false,
            bonuses: false,
            webhook: webhook.to_string(),
        }
    }

    fn tiered(
        name: &str,
        tiers: (Option<i16>, Option<i16>),
        untiered: bool,
        webhook: &Url,
    ) -> Feed {
        Feed {
            min_tier: tiers.0,
            max_tier: tiers.1,
            untiered,
            ..feed(name, Records::WorldRecords, webhook)
        }
    }

    /// A stand-in Discord webhook that keeps what it's sent.
    pub(crate) async fn fake_webhook() -> (Url, Arc<Mutex<Vec<Value>>>) {
        let received = Arc::new(Mutex::new(Vec::new()));
        let keep = received.clone();
        let app = Router::new().route(
            "/hook",
            post(move |Json(body): Json<Value>| async move {
                keep.lock().unwrap().push(body);
                axum::http::StatusCode::NO_CONTENT
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (
            Url::parse(&format!("http://{address}/hook")).unwrap(),
            received,
        )
    }

    async fn submit(db: &PgPool, key: &str, body: &Value) -> i64 {
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(key), body)
            .await
            .json();
        accepted.id
    }

    fn by(player: &str, steamid64: &str, server_run_id: &str, time: f64) -> Value {
        let mut body = run(server_run_id, time);
        body["player"] = json!({ "steamid64": steamid64, "name": player });
        body
    }

    /// Runs each feed once, after every transaction begun so far has finished, as `record_events` tests do.
    async fn feed_once(db: &PgPool, feeds: &[Feed]) {
        let begun: i64 = sqlx::query_scalar("SELECT pg_current_xact_id()::text::bigint")
            .fetch_one(db)
            .await
            .unwrap();
        for _ in 0..500 {
            let oldest_running: i64 =
                sqlx::query_scalar("SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint")
                    .fetch_one(db)
                    .await
                    .unwrap();
            if oldest_running > begun {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let links = Links {
            public_url: Url::parse("https://sourcejump.test/").unwrap(),
            storage: Storage::for_tests(),
        };
        for feed in feeds {
            post_new_records(db, &reqwest::Client::new(), feed, &links)
                .await
                .unwrap();
        }
    }

    /// Publishes a tier count and gives the test map a tier, before its first run.
    async fn set_tier(db: &PgPool, tier: i16) {
        sqlx::query("INSERT INTO maps (name) VALUES ('bhop_badges')")
            .execute(db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO policies (name, version, value) VALUES ('tiers', 1, '{\"count\": 6}')",
        )
        .execute(db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO map_tiers (map_id, track, tier) SELECT id, 0, $1 FROM maps WHERE name = 'bhop_badges'")
            .bind(tier)
            .execute(db)
            .await
            .unwrap();
    }

    fn embeds(received: &Mutex<Vec<Value>>) -> Vec<Value> {
        received
            .lock()
            .unwrap()
            .iter()
            .flat_map(|message| message["embeds"].as_array().unwrap().clone())
            .collect()
    }

    #[sqlx::test]
    async fn new_world_records_go_to_the_feeds_that_take_them_once(db: PgPool) {
        let key = setup(&db).await;
        let (webhook, received) = fake_webhook().await;
        let feeds = [
            tiered("normal low", (Some(1), Some(3)), true, &webhook),
            tiered("normal high", (Some(4), None), false, &webhook),
        ];
        // The first pass starts the cursors, so runs from before the feeds existed aren't posted.
        submit(&db, &key, &run("old", 31.0)).await;
        feed_once(&db, &feeds).await;
        submit(&db, &key, &run("a", 30.0)).await;
        // Second place on the board: not a world record.
        submit(&db, &key, &by("second", "76561197960287931", "b", 32.0)).await;
        // Ties the record and shares rank 1, but isn't faster: not a world record either.
        submit(&db, &key, &by("tie", "76561197960287932", "c", 30.0)).await;
        feed_once(&db, &feeds).await;
        feed_once(&db, &feeds).await;

        let embeds = embeds(&received);
        assert_eq!(
            embeds.len(),
            1,
            "one record, to the untiered feed only: {embeds:?}"
        );
        assert_eq!(embeds[0]["author"]["name"], "bhop_badges");
        assert_eq!(
            embeds[0]["author"]["url"],
            "https://sourcejump.test/maps/bhop_badges"
        );
        assert_eq!(embeds[0]["fields"][1]["value"], "30.000 (-1.000)");
        assert_eq!(embeds[0]["footer"]["text"], "World Record · Normal");
    }

    #[sqlx::test]
    async fn a_tier_routes_the_record_and_a_restore_is_not_posted_again(db: PgPool) {
        let key = setup(&db).await;
        set_tier(&db, 5).await;
        let (webhook, received) = fake_webhook().await;
        let feeds = [
            tiered("normal low", (Some(1), Some(3)), true, &webhook),
            tiered("normal high", (Some(4), None), false, &webhook),
        ];
        feed_once(&db, &feeds).await;
        let record = submit(&db, &key, &run("a", 30.0)).await;
        feed_once(&db, &feeds).await;
        invalidate_run(&db, None, record, Some("test"))
            .await
            .unwrap();
        restore_run(&db, None, record, Some("test")).await.unwrap();
        feed_once(&db, &feeds).await;

        let embeds = embeds(&received);
        assert_eq!(embeds.len(), 1);
        assert_eq!(
            embeds[0]["author"]["icon_url"],
            "https://sourcejump.test/tiers/t5.png"
        );
        assert_eq!(embeds[0]["fields"][1]["value"], "30.000");
    }

    #[sqlx::test]
    async fn a_run_restored_later_in_the_same_page_is_posted_once(db: PgPool) {
        let key = setup(&db).await;
        let (webhook, received) = fake_webhook().await;
        let feeds = [feed("every best", Records::PersonalBests, &webhook)];
        feed_once(&db, &feeds).await;
        // Another player's run between the first and the restore keeps the two reports of `first` apart.
        let first = submit(&db, &key, &run("a", 30.0)).await;
        submit(&db, &key, &by("second", "76561197960287931", "b", 32.0)).await;
        invalidate_run(&db, None, first, Some("test"))
            .await
            .unwrap();
        restore_run(&db, None, first, Some("test")).await.unwrap();
        feed_once(&db, &feeds).await;

        let embeds = embeds(&received);
        assert_eq!(embeds.len(), 2, "each run once: {embeds:?}");
    }

    #[sqlx::test]
    async fn a_personal_best_feed_posts_every_new_best_with_its_rank(db: PgPool) {
        let key = setup(&db).await;
        let (webhook, received) = fake_webhook().await;
        let feeds = [Feed {
            style: None,
            ..feed("pbs", Records::PersonalBests, &webhook)
        }];
        feed_once(&db, &feeds).await;
        submit(&db, &key, &run("a", 30.0)).await;
        submit(&db, &key, &by("second", "76561197960287931", "b", 33.0)).await;
        // Slower than their best: not a personal best, so not posted.
        submit(&db, &key, &by("second", "76561197960287931", "c", 34.0)).await;
        submit(&db, &key, &by("second", "76561197960287931", "d", 32.0)).await;
        feed_once(&db, &feeds).await;

        let embeds = embeds(&received);
        // The 33 s run is no longer anyone's best when the feed reads it.
        let seen: Vec<_> = embeds
            .iter()
            .map(|e| {
                (
                    e["fields"][1]["value"].clone(),
                    e["fields"][2]["value"].clone(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            [
                (json!("30.000"), json!("#1")),
                (json!("32.000 (-1.000)"), json!("#2"))
            ]
        );
        assert_eq!(embeds[1]["footer"]["text"], "Personal Best · Normal");
        assert_eq!(received.lock().unwrap().len(), 1, "both in one message");
    }

    #[test]
    fn tier_ranges_include_both_ends() {
        let webhook = Url::parse("https://discord.test/hook").unwrap();
        let low = tiered("low", (Some(1), Some(3)), true, &webhook);
        let high = tiered("high", (Some(4), None), false, &webhook);
        let any = feed("any", Records::WorldRecords, &webhook);
        assert!(low.takes_tier(Some(3)) && !low.takes_tier(Some(4)) && low.takes_tier(None));
        assert!(high.takes_tier(Some(4)) && high.takes_tier(Some(6)) && !high.takes_tier(None));
        assert!(any.takes_tier(None) && any.takes_tier(Some(6)));
    }

    #[test]
    fn a_config_with_two_feeds_of_one_name_is_refused() {
        let dir = std::env::temp_dir().join(format!("sj-feeds-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("feeds.json");
        let one =
            json!({ "name": "normal", "style": "normal", "webhook": "https://discord.test/a" });
        std::fs::write(&path, json!([one, one]).to_string()).unwrap();
        assert!(read_feeds(&path).unwrap_err().contains("two feeds"));
        let pbs = json!({ "name": "pbs", "records": "personal_bests", "bonuses": true, "webhook": "https://discord.test/b" });
        std::fs::write(&path, json!([one, pbs]).to_string()).unwrap();
        let feeds = read_feeds(&path).unwrap();
        assert_eq!(feeds[1].records, super::Records::PersonalBests);
        assert!(feeds[1].style.is_none() && feeds[1].bonuses);
    }
}
