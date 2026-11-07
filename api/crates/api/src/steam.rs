//! Steam Community, the one outside service the API calls: `OpenID` sign-in and public profiles.

use std::{collections::HashSet, sync::Arc, time::Duration};

use tokio::{
    sync::{Mutex, Semaphore},
    time::Instant,
};
use url::Url;

use crate::players::{SteamId64, steam_profile};

#[derive(Clone, Debug)]
pub struct Steam {
    pub http: reqwest::Client,
    /// Where sign-in sends players, and where assertions are checked.
    pub openid_endpoint: Url,
    /// The community site's root, for profile pages.
    pub community: Url,
    last_request: Arc<Mutex<Option<Instant>>>,
    /// Players whose profile refresh is waiting or running (`players/steam_profile.rs`).
    pub(crate) profile_refreshes: Arc<std::sync::Mutex<HashSet<SteamId64>>>,
    /// Slots for profile fetches a request waits on (`players/steam_profile.rs`, `refresh_now`).
    pub(crate) inline_fetches: Arc<Semaphore>,
}

impl Steam {
    pub fn new() -> Self {
        Self::with_base(&Url::parse("https://steamcommunity.com/").expect("a valid URL"))
    }

    /// Points every call at `base` instead of steamcommunity.com, for tests with a stand-in server.
    pub fn with_base(base: &Url) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("SourceJump (sourcejump.net)")
            // Steam answers sign-in checks directly; a redirect would mean something is wrong.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("the HTTP client's settings are valid");
        Self {
            http,
            openid_endpoint: base.join("openid/login").expect("a valid path"),
            community: base.clone(),
            last_request: Arc::new(Mutex::new(None)),
            profile_refreshes: Arc::default(),
            inline_fetches: Arc::new(Semaphore::new(steam_profile::INLINE_FETCHES)),
        }
    }

    /// Waits until at least `gap` has passed since the last caller's turn. Callers queue up behind each other,
    /// so a burst of profile views turns into a steady trickle of requests to Steam.
    pub async fn wait_for_turn(&self, gap: Duration) {
        let mut last = self.last_request.lock().await;
        if let Some(previous) = *last {
            tokio::time::sleep_until(previous + gap).await;
        }
        *last = Some(Instant::now());
    }
}
