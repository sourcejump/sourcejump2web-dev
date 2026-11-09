# Site API
The website's endpoints; staff tools: `staff-api.md`. Rules for every client and game servers' endpoints: `api.md`.

## Sign-in and sessions
Steam OpenID sign-in uses the configured site origin for cookies and callbacks, canonicalizing aliases first.
- Steam must confirm its answer (`check_authentication`). Only signed fields are read, the return URL must be our callback, a nonce works once, within 5 minutes (`openid_nonces`). The callback must carry the value `/v1/auth/steam` put in the `sj_sign_in` cookie, tying sign-in to its browser. Refused: `/sign-in/failed`; cancelled: back where they were.
- `return_to` must be a path on our site; anything else becomes `/`.
- A session is 32 random bytes in the `sj_session` cookie (`HttpOnly; Secure; SameSite=Lax`); only its SHA-256 is stored. It lasts 30 days from last use (expiry moves at most daily).
- Sign-out needs our `Origin`; so does `…/sign-out-everywhere`, which ends all their sessions. A missing session gets `401` without `WWW-Authenticate`.
- `SJ_PUBLIC_URL`, where players reach the site, builds redirects and the origin check.

## Players and privileges
- Profiles take a SteamID64, SteamID2 or SteamID3 and answer with a SteamID64.
- Per style, a profile counts completed maps (main tracks, out of the map list's count), completed bonuses and world records, and carries the first 50 main-track PBs by map; `…/personal-bests?style=&tracks=main|bonuses&cursor=` pages on; `records=true` keeps only 2.0 world records. Without `style`, every style, newest first; `all_styles` counts across styles. Ranks: `main_standing`, `bonus_standing` (lead, 2026-11-04). PBs have a placement (ties share one), `tier` and `world_record_time`; profiles `tier_count`.
- `PUT /v1/players/{player}/details` (`players/details.rs`): setup and a country (`GET /v1/countries`), a save per 5 s; others' need `manage_bans` and a logged reason. Old-site setup shows first.
- Country: a run's server GeoIP code, else the player's pick (shown until the next such run), else Steam's.
- Avatar, country and (until a run gives one) name come from the public Steam profile XML, fetched at sign-in, and when a day old after a run, view or `…/avatar` (an hour after a failure): one request per 2 s, 50 queued, one per player. Country names map to ISO codes in `players/countries.rs`.
- `GET /v1/players/{player}/avatar` (`players/avatar.rs`) 302s to the stored Steam CDN avatar (cached a day); if none, fetched unpaced (4 at once, 4 s), else an initials SVG (5 min). Unknown: 404, no fetch; legacy-only: the old site's.
- Staff privileges: a bitmap in `players.privileges` (`players/privileges.rs`); bit positions never change; the API names them, never numbers. `players.restrictions` is unused (bans hold restrictions). The CLI's `privileges grant <steamid> <name>…`, `revoke`, `list` and the staff tools share `staff/privileges.rs`.

## Maps and leaderboards
- Maps with runs (`maps.last_run_at`). `q` searches map names and the style's main WR holders. Sorts: name, players, last/first run (`listed_at`), tier and main WR. `tier` keeps one main tier. `player` (any SteamID) with `completed=true|false` filters the style's main completions; `completed` counts them. Global `stats` totals; newest and weekly lists take five within `stats.tier` (null: all). Weekly counts distinct players.
- Leaderboards rank PBs per map, style and track; equal times share a place, the earlier run listed first. A tie's world record belongs to whoever set it first.
- `GET /v1/maps/{map}` carries every style and track's top 25, `next_cursor` and WR history, for map pages to switch locally. `…/leaderboard?cursor=` pages on from there; cursors are opaque.
- WR history: every run faster than all finished before it on that board, by `finished_at`; ties don't count.
- Tiers: the `tiers` policy holds the tier count, `map_tiers` the tier per map and track (append-only, newest in force). The API serves no tier until a count is published.
- Any run opens by ID with stats, server and place (while a PB); compliance and keys stay private.
- Pre-2.0 runs (`legacy_*` tables, `legacy.rs`) count toward no 2.0 standing: not WRs, WR histories, placements or `…/records`. The normal style's main track also has `view=all` (each player's faster of 2.0 and legacy) and `view=legacy` on `…/leaderboard` and `…/personal-bests`; entries carry `legacy`; a legacy `run_id` is the old site's, at `GET /v1/legacy-runs/{id}` (no run page). A map's `legacy_record_history` charts the Pre-2.0 view. Banned players' legacy runs are left out. Legacy-only maps and players have pages and show in search.
- The CLI's `tiers count` publishes the count (never below a tier a map holds). Staff rate tracks and set images and descriptions on the map's Manage view (`/maps/{map}/manage`), or with the CLI's `maps tier` and `maps image`, logged.
- A map holds up to 10 pictures (`map_images`, ordered; first is the cover). The API takes PNG, JPEG or WebP ≤15 MB, crops to 16:9, centred (at least 1920×1080), and stores 1920×1080 and 480×270 WebP at quality 80 (`maps/image.rs`), named by content hash, cached for good, deleted with the picture. `GET /v1/maps/{map}` carries `images`, each with both URLs and `focus` (0–100, the strip a banner shows); lists carry the cover as `image`. Browsers read them from `SJ_S3_PUBLIC_URL`; the API only writes (ADR 0006).
- Staff set `description` (≤1000 chars), `released` (year, month or day) and `mapper` (made if new)

## Player leaderboards
- `GET /v1/leaderboards?style=&track=main|bonuses` gives, in one style and kind of track, the top 20 (`limit`) by points and by tracks completed (`leaderboards.rs`); equal shown (rounded) values share a rank. `view=legacy` ranks legacy records (one style, main tracks, the old site's tiers), banned players left out; never counted toward 2.0. `GET /v1/leaderboards/points|completed` is one list in full (`limit`, `offset`, `total`), and each player's world records in that style and kind of track (`leaderboards/list.rs`).
- Points per PB: a map is worth `base` at tier 1, times `growth_percent` each tier up (a bonus `bonus_percent` of that at its own tier); finishing earns `finish_percent`, the rest is speed, `(WR ÷ time) ^ speed_exponent` (SQL `points_for`). Untiered tracks earn none. The `points` policy holds the values; until one is published the API uses `PointsPolicy::DRAFT` (50, 200, 50, 4, 25) and says `draft` (lead, 2026-10-26).
- Stored, not computed per visit (lead, 2026-10-26): `personal_bests.points`, `standings` (per style, main and bonuses apart) and `legacy_standings`, recounted by `leaderboards/standings.rs` where they change: a track when a PB or its tier changes there (a new WR moves all points); everything on a points or tiers policy, or at startup if the formula changed; legacy on bans, lifts, imports. One advisory lock serializes recounts. So are world records (`leaderboards/world_records.rs`): holders and `runs.was_record`, per board.

## Activity
- `GET /v1/runs?style=&track=main|bonus&min_tier=&records=&cursor=&offset=` (`runs/recent.rs`, with `total`): valid runs newest first by `finished_at`, each with its board's tier, `placement` against the valid runs before it (null unless a PB), `world_record` (as in WR history) and `gap` to the record it faced. `min_tier` matches nothing until a tier count is published.

## Daily totals
- `GET /v1/daily-totals/players|runs?range=month|year|all` (`daily_totals.rs`, hourly): players with a time (incl. pre-2.0), 2.0 runs and WRs per UTC day.

## Server list
- `GET /v1/servers` shows only addresses in `server_listings`, kept by staff (lead, 2026-10-20), heard from within the `servers` policy's `listed_hours` (24); `online` means within `online_minutes` (25). No policy, no list. *Connected*: the latest heartbeat had a still-valid key. Compliance and versions aren't public. `whitelist` (staff-set: only approved players join) puts it under the Whitelist tab.
- Listed servers' heartbeats also go to `server_heartbeat_log` (players, 30 days) and, per UTC day for 400 days, `server_activity_daily` (per-server totals) and `server_activity_peaks`. `…/activity?range=day|week|month` buckets the log (20 min, 2 h, 8 h), `year` the daily tables. Per bucket: servers heard from, their average players summed, `peak_players` (most online at once); the top-level one, the whole range through now (never above a longer range's).
- Staff with `manage_servers` see every server on `/servers`: unlisted ones dimmed, listing and whitelist toggles, and a dialog with its last report (versions, plugins, compliance, reported IP, key), browser-loaded, never server-rendered. The CLI's `servers seen` and `servers list|unlist <ip:port>` do the same.

## Community posts
- Articles (Markdown) and YouTube videos (a link with an optional note; the site links out and embeds nothing, lead 2026-10-20). `post_community` lets players post and change or remove their own; `manage_posts` edits anyone's, with a `reason`, logged (`edit_post`, fields changed) if someone else's and changed. Every write needs a session and our `Origin`.
- `body_html` is rendered on each read by `posts/markdown.rs`, sole judge of the HTML a post may hold: raw HTML becomes text, images their alt text, and links keep only web, mail and on-site addresses, opening `nofollow noopener`.
- Video links in any common form are stored as YouTube IDs (`posts/youtube.rs`), served as watch links.
- Pages link to `/community/{id}-{slug}`; only the ID counts, so retitling keeps links. Removal hides a post (the row stays); `DELETE /v1/posts/{post}` is the author's alone.

## Run comments
- `/v1/runs/{id}/comments` (`runs/comments.rs`): players not banned from posting comment and reply one level deep (plain text, one per 30 s); the runner pins one; authors `DELETE` theirs (lead 2026-10-29). 25 threads a page, 3 replies each; more at `…/replies`.

## Replay viewer
- Viewer files and CS:S stock content: `docs/replay-viewer.md`.
