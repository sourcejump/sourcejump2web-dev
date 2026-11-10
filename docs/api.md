# API
How the `/v1/` API behaves for game servers, and rules every client can rely on. The website's own endpoints (sign-in, players, maps, servers, posts): `site-api.md`. The exact schema is `api/openapi.json`. Examples, checked by `cargo test`: `api/contract/`.

## Endpoints
| Endpoint | Key | Code |
|---|---|---|
| `GET /v1/ruleset` | no | `ruleset.rs` |
| `GET /v1/maps/{map}/zones` | no | `zones.rs` |
| `GET /v1/maps/{map}/records`, `…/personal-bests` | no | `records.rs`, `records/` |
| `GET /v1/records/events`, `GET /v1/records/stream` | no | `record_events.rs`, `record_events/stream.rs` |
| `GET /v1/maps`, `GET /v1/maps/{map}`, `…/leaderboard`, `…/wr-history` | no | `maps/` |
| `GET /v1/runs/{id}` | no | `runs/detail.rs` |
| `GET /v1/plugin/latest` | no | `plugin_releases.rs` |
| `POST /v1/servers/heartbeat` | optional | `servers/heartbeat.rs` |
| `GET /v1/servers`, `…/activity` | no | `servers/list.rs`, `servers/activity.rs` |
| `POST /v1/runs` | yes | `runs.rs`, `replays.rs` |
| `GET /v1/replays/{run_id}` | no | `replays/download.rs` |
| `POST /v1/anticheat/detections` | yes | `anticheat.rs` |
| `GET /v1/players`, `GET /v1/players/{player}`, `…/personal-bests` | no | `players/` |
| `GET /v1/auth/steam`, `GET /v1/auth/steam/callback`, `POST /v1/auth/sign-out` | browser | `auth.rs`, `auth/openid.rs` |
| `GET /v1/me` | session | `auth.rs`, `auth/sessions.rs` |
| `GET /v1/posts`, `GET /v1/posts/{post}`; `POST`, `PUT`, `DELETE` to write | no; session to write | `posts.rs`, `posts/` |
| `/v1/staff/…`: log, keys, servers, listings | staff session | `staff.rs`, `staff/` |

## Rules every client can rely on
- **Errors** have the body `{"error": "..."}`, for people; don't match on it.
- **Retrying:** `2xx` means stored. Network errors, `5xx` and `429` (too many) are temporary: keep the item queued, resend later. Any other `4xx` is final: the request breaks a rule, so the plugin drops it.
- **Idempotency:** runs and detections carry an ID from the game server (`server_run_id`, `server_detection_id`), unique per server. A resend gets `200` with the first answer and changes nothing; the first send gets `201`.
- **SteamID64s** are JSON strings: too big for a JavaScript number, and SourcePawn has no 64-bit integers.
- **Map names** are lowercased; other characters than `a-z 0-9 _ - .`, or only dots, are rejected.
- **Server times** (`finished_at`, `detected_at`) are Unix seconds by the game server's clock. The API also stores when it got each. `422` if over 5 minutes ahead of the API's clock, or a run over 5 minutes before its ruleset version or server existed.

## Keys
- One key per server, sent as `Authorization: Bearer sj_…`. Only its SHA-256 is stored, so a lost key is replaced, never recovered.
- A missing, unknown or revoked key gets `401` on keyed endpoints (`ServerKey` in `servers/keys.rs`). The heartbeat never rejects for its key; it answers `valid`, `revoked`, `unknown` or `none`.
- Every run and detection records the key it came with, so revoking a key can invalidate every run its server sent, with any key (staff choose, `site-api.md`).
- Staff issue, replace and revoke keys on `/staff/keys` (or `sourcejump-api keys issue "<server name>"`, `keys revoke <prefix>`). A server holds one active key at a time (a unique index); a new key revokes its old one in the same step. Owners request keys on the Discord (`domain.md`).

## Server heartbeats
- Every plugin server, keyed or not, sends one on map start and then every `next_heartbeat_seconds` (600 now): hostname, port, map, players and slots, versions (`shavit_version` null without shavit), plugins, compliance.
- A server is its address: the IP the heartbeat came from plus its reported port. Behind Caddy the IP is the last `X-Forwarded-For` entry, `country_code` Cloudflare's `CF-IPCountry` (`XX`, `T1`: none), trusted only from this machine (`client_address.rs`). The reported `ip` is for staff, never trusted.
- Only the latest heartbeat per address is kept (`server_heartbeats`), at most 32 ports per IP; an hourly job drops unlisted ones silent 7 days. A valid key links the address to its `servers` row.
- Over 64 KB gets `413`. Hostnames lose control characters, cut to 64. An IP (IPv6: /64) may send 120 at once, then 30 a minute; more get `429`, before any key check (`heartbeat_limit.rs`).

## Runs
- Accepted only if the run's ruleset version exists, its style is ranked in that version, its tickrate matches the ruleset's `tickrate` if set, and the plugin reports the server as compliant.
- `personal_bests` holds each player's fastest run per map, style and track, updated in the same transaction. A tie keeps the earlier run.
- Any keyed server can add a map by submitting a run on it. Which maps are ranked is a separate decision.

## Replays
- The `replays` policy decides which replays are wanted (`request`: `new_personal_best`, the lead's call on 2026-10-19; `every_run` or `nothing`) and which styles' replays are public (`public_styles`: every ranked style, lead 2026-11-03). A missing policy asks for nothing and makes nothing public.
- A wanted replay gets a presigned `PUT` link, valid for an hour, to `uploads/replays/<run id>-<random>.replay` in a private bucket. A resend of the run returns a fresh link, with `last_refusal` (reason, time) if the last upload was refused, or no link once the replay is stored (delete the local copy).
- Every 30 s a job (`replays/processing.rs`) lists the uploads and checks each against its run: shavit format 12 only, frames fill the file exactly, same map (any case), track, player and tickrate, and the time within half a tick. Over 128 MB is refused. A good file is stored as SJR (`replays/sjr.rs`, a fifth the size) at `replays/<run id>-<random>.sjr`; the upload is deleted. A bad one is deleted, its reason kept on the `replays` row, and the server may upload again. A stored replay never changes; a failing upload is retried.
- The bucket is public; random keys mean only the API reveals files. `GET /v1/runs/{id}` gives the SJR link (`replay.sjr_url`; invalidated runs too, lead 2026-11-03), its route from above (`replay.route`, `replay-viewer.md`), and `GET /v1/replays/{run_id}` the shavit file, rebuilt byte for byte at its first download and kept (own random key), only while the run is valid and its style is public.
- `GET /v1/maps/{map}/records` marks each record `has_replay` by the same rule, so a server only asks for files it will get.

## Map records for `/wr`
- `GET /v1/maps/{map}/leaderboard?style=&track=` pages one board (`total`, `next_cursor`); `player=` (any SteamID) adds their best and rank as `player_entry`. Opaque cursors name where a page ended, so paging survives that player improving; old run-ID ones work while the run is a PB. Its rows and `…/records`' carry `points` and `has_replay`.
- `…/personal-bests?players=` (1–64 SteamID64s): their bests in every style and track, with `rank`.
- All three send an `ETag` (`etag.rs`, a body hash); `If-None-Match` with it gets a bodiless `304` until the answer changes. So do `/v1/ruleset`, `…/zones` and `/v1/plugin/latest`.

## Record events
- `GET /v1/records/events` lists what happened to records, for servers announcing them or playing them on their bot: `run` (a new personal best, or a restored run that is one again), `replay` (its replay stored) and `invalidated` (staff took a run off a board; read the map's records again). Events are written with their change and kept a week. `previous_time` is the player's best on the board before that run, as it stood then (null: none; migration 0043). The same events feed the Discord posts of records and personal bests (`record_events/discord.rs`).
- Servers poll every 10 to 30 s with `after`, the `next` of their last answer; without it they get only a `next` from now. Cursors are opaque. `max_rank` (default 1) keeps runs at that rank or better now; `invalidated` events always come.
- Pages hold only events from transactions older than every running one, so a late commit is delayed, never skipped.
- `GET /v1/records/stream` pushes the same events as server-sent events (`event:` kind, `id:` cursor, `data:` the event), starting from `Last-Event-ID`, `after` or now, with a comment every 15 s. One reader, woken by `NOTIFY`, reads each event once for every stream (`stream.rs`); an IP may hold 40 streams, `429` past that. Streams end at shutdown; clients reconnect with `Last-Event-ID`.
- The ruleset's `features.record_events` and `features.record_stream` tell the plugin to follow them (migration 0035).

## Policies and versioned data
Rulesets, zone sets and `policies` (community policy the plugin doesn't need: `servers`, `replays`, `tiers`, typed in `policies.rs`) are append-only: database triggers refuse updates and deletes. A change is a new version, and the newest version is in force. Runs record the ruleset version they were played under. A new version ships as a migration (lead, 2026-10-21); a test checks every ruleset they publish (`RulesetDocument::check`).
- Ranked styles carry shavit `settings` and `flags`; `RankedStyle` (`ruleset.rs`) says how they match. Provisional values: migrations 0041–0042 (lead, 2026-11-04).

## Zones
Served in exactly the JSON array `shavit-zones-json` reads, so servers point `shavit_zones_json_url` at `/v1/maps/{map}/zones`. A `404` means SourceJump has no zones for the map, and servers don't submit there. The `SourceJump-Zone-Set-Version` header (on `304` too) names the set served. Staff publish zone sets (`staff-api.md`); everyone sees the set in force at `/maps/{map}/zones`. Runs carry a zone fingerprint, stored as sent; checking it comes with run verification.

## Not yet decided or built
- Field names can still change: no client uses them yet. Once plugin work starts, the lead approves the contract and it's copied to the plugin repo.
- Whether old plugin endpoints keep working, how zones are submitted and reviewed, and whether keyless servers' queued runs can be imported later.
