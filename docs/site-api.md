# Site API
What the endpoints behind the website do: sign-in, players, maps, the server list and community posts; the staff tools are in `staff-api.md`. Rules for every client (errors, retries, SteamIDs) and game servers' endpoints: `api.md`.

## Sign-in and sessions
Players sign in with Steam (OpenID 2.0); the endpoints answer browsers (redirects, cookies) via the site's origin.
- Steam must confirm its answer (`check_authentication`). Only signed fields are read, the return URL must be our callback, a nonce works once, under 5 minutes old (`openid_nonces`). The callback URL must carry the value `/v1/auth/steam` put in the `sj_sign_in` cookie, tying sign-in to its browser. Refused: `/sign-in/failed`; cancelled: back where they were.
- `return_to` must be a path on our site, else `/`.
- A session is 32 random bytes in the `sj_session` cookie (`HttpOnly; Secure; SameSite=Lax`). Only the SHA-256 is stored. It lasts 30 days from last use (expiry moves at most daily).
- Sign-out, and `…/sign-out-everywhere` (all their sessions), need our `Origin` header. A missing session answers `401` without `WWW-Authenticate`.
- `SJ_PUBLIC_URL` is where players reach the site; redirects and the origin check use it.

## Players and privileges
- `GET /v1/players` (`players/list.rs`): a search, else who ran in 30 days; latest run, runs per day, `total`.
- Profiles take any SteamID form and answer with the SteamID64. Placements rank personal bests per board; equal times share a place.
- Per style, a profile counts completed maps (main tracks, of the map list's; per tier of `maps_by_tier`), bonuses and world records, with the first 50 main-track personal bests by map; `…/personal-bests?style=&tracks=main|bonuses&q=&cursor=` pages on (`q`: map name), `records=true` keeps world records (2.0 only). No `style`: every style, newest first; `all_styles` counts across styles. `runs`: a board's valid runs, listed fastest first by `…/runs?map=&style=&track=`. `activity`: a year's runs per day (`players/activity.rs`). Ranks: `main_standing`, `bonus_standing` (lead, 2026-11-04).
- `PUT /v1/players/{player}/details` (`players/details.rs`): setup and a country (`GET /v1/countries`), a save per 5 s; others' need `manage_bans` and a logged reason. Old-site setup shows first.
- Avatar, country (unless picked) and name (until a run gives one) come from Steam's profile XML, fetched at sign-in, after a run if never fetched, and on viewing one a day old (1 h after failing): 1 request per 2 s, 50 queued. Countries map to ISO codes in `players/countries.rs`.
- Privileges are a bitmap in `players.privileges` (`players/privileges.rs`). Bit positions never change; the API sends names, never numbers. `players.restrictions` is unused (bans hold restrictions). The CLI's `privileges grant <steamid> <name>…`, `revoke`, `list` and the staff tools share `staff/privileges.rs`.

## Maps and leaderboards
- The map list holds every map with a run (`maps.last_run_at`, set on ingest); ranking is open. Sorts: name, players, last/first run (`listed_at`), tier, main-track record; `tier` keeps one tier (`stats`' lists too). `player` (any SteamID) with `completed=true|false` keeps maps whose main track they have or haven't finished; `completed` counts them. `times=true` adds each map's top 3 and `viewer`'s place. `stats`: tiers, 5 newest, week's 5 most played.
- Of equal times on a leaderboard, the earlier is listed first and holds the WR.
- `GET /v1/maps/{map}` carries every style and track's top 25, `next_cursor` and WR history, so switching needs no request. `…/leaderboard?cursor=` pages on from there; cursors are opaque.
- WR history: every run faster than all that finished before it on that leaderboard (`finished_at`); ties don't count.
- Tiers: the `tiers` policy holds the tier count (CLI `tiers count`; never below a tier a map holds), `map_tiers` the tier per map and track (append-only, newest in force). No tier is served until a count is published.
- A run opens by ID with stats, server and place (while a personal best); compliance and keys stay private.
- Pre-2.0 runs (`legacy_*` tables, `legacy.rs`) count toward no 2.0 standing: not WRs, WR histories, placements or `…/records`. The normal style's main track has two more views on `…/leaderboard` and `…/personal-bests`: `view=all` (each player's faster of 2.0 and legacy), `view=legacy`; entries carry `legacy`; a legacy `run_id` is the old site's, at `GET /v1/legacy-runs/{id}` (no run page). A map's `legacy_record_history` charts Pre-2.0. Banned players' legacy runs are left out. Legacy-only maps and players get pages and search.
- Staff rate tracks and set images and descriptions on the map's Manage view (`/maps/{map}/manage`), or with the CLI's `maps tier` and `maps image`, logged.
- A map holds up to 10 pictures (`map_images`, in order; the first is the cover). PNG, JPEG or WebP up to 15 MB is cropped to 16:9, centred (at least 1920×1080), and stored as 1920×1080 and 480×270 WebP at quality 80 (`maps/image.rs`), named by content hash, cached for good, deleted with the picture. `GET /v1/maps/{map}` carries `images` (both URLs; `focus` 0–100, the strip a banner shows); lists carry the cover as `image`. Browsers read them from `SJ_S3_PUBLIC_URL` (ADR 0006).
- Staff set `description` (≤1000 chars), `released` (year, month or day) and `mapper` (made if new)
- Link cards (`maps/card.rs`): one 1200×630 JPEG per map with a cover (`card_url`; runs' `map_card_url`); other pages: `web/public/link-card.jpg` (`site-card`).

## Player leaderboards
- `GET /v1/leaderboards?style=&track=main|bonuses` gives, in one style and kind of track, the top 20 (`limit`) by points and by tracks completed (`leaderboards.rs`); equal shown (rounded) values share a rank. `view=legacy` ranks legacy records (one style, main tracks, the old site's tiers), banned players left out; never counted toward 2.0. `GET /v1/leaderboards/points|completed` is one list in full (`limit`, `offset`, `total`), and each player's world records in that style and kind of track (`leaderboards/list.rs`).
- Points per personal best: a map is worth `base` at tier 1, times `growth_percent` each tier up (a bonus `bonus_percent` of that at its own tier); finishing earns `finish_percent`, the rest is speed, `(WR ÷ time) ^ speed_exponent` (SQL `points_for`). Untiered tracks earn none. The `points` policy holds the values; until one is published the API uses `PointsPolicy::DRAFT` and says `draft` (lead, 2026-10-26).
- Stored, not computed per visit (lead, 2026-10-26): `personal_bests.points`, `standings` (per style, main and bonuses apart) and `legacy_standings`, recounted by `leaderboards/standings.rs` where they change: a track when a personal best or its tier changes there (a new WR moves all points); everything on a points or tiers policy, or at startup if the formula changed; legacy on bans, lifts, imports. One advisory lock serializes recounts. So are world records (`leaderboards/world_records.rs`): holders and `runs.was_record`, per board.

## Activity
- `GET /v1/runs?style=&track=main|bonus&min_tier=&records=&cursor=` (`runs/recent.rs`): valid runs newest first by `finished_at` (`total` on page one), each with its board's tier, `placement` among the valid runs before it (null unless it beat their own best), `world_record` (as in WR history) and its `gap` to the record it faced. `min_tier` matches nothing until a tier count is published.

## Daily totals
- `GET /v1/daily-totals/players|runs?range=month|year|all` (`daily_totals.rs`, hourly): players with a time (incl. pre-2.0), 2.0 runs and WRs per UTC day.

## Server list
- `GET /v1/servers` shows only addresses in `server_listings`, kept by staff (lead, 2026-10-20), heard from within the `servers` policy's `listed_hours` (24); `online` means within `online_minutes` (25). Without the policy the list is empty. *Connected*: the latest heartbeat had a still-valid key. Compliance and versions aren't public. `whitelist` (staff-set: only approved players join) puts it under the Whitelist tab.
- Listed servers' heartbeats also go to `server_heartbeat_log` (players, 30 days) and `server_activity_daily` (per-server UTC-day totals, 400 days). `…/activity?range=day|week|month` buckets the log (20 min, 2 h, 8 h); `year` reads the daily totals. Per bucket: servers heard from, and their average players summed.
- Staff with `manage_servers` see every server on `/servers`: unlisted ones dimmed, toggles to list or unlist and to mark whitelist, and a dialog with its last report (versions, plugins, compliance, reported IP, key), loaded in the browser, never in the server render. The CLI's `servers seen|list|unlist` do the same.

## Community posts
- Articles (Markdown) and YouTube videos (a link with an optional note; the site links out and embeds nothing, lead 2026-10-20). Players with `post_community` post and change or remove their own; `manage_posts` edits anyone's, with a `reason` and logged (`edit_post`, fields changed) when it's someone else's and changes something. Every write needs a session and our `Origin`.
- `body_html` is rendered on each read by `posts/markdown.rs`, the only place deciding what HTML a post may contain: raw HTML becomes text, images their alt text, and links keep only web, mail and on-site addresses, opening `nofollow noopener`.
- A video link in any common form is stored as its YouTube ID (`posts/youtube.rs`), served back as a watch link.
- Pages link to `/community/{id}-{slug}`; only the ID counts, so a new title doesn't break links. Removing a post hides it and keeps the row. `DELETE /v1/posts/{post}` is for the author only.

## Run comments
- `/v1/runs/{id}/comments` (`runs/comments.rs`): players not banned from posting comment and reply one level deep (plain text, one per 30 s); the runner pins one; authors `DELETE` theirs (lead 2026-10-29). 25 threads a page, 3 replies each; more at `…/replies`.

## Replay viewer
- Viewer files and CS:S stock content: `docs/replay-viewer.md`.
