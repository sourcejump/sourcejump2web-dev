# Roadmap
| # | Slice | Status | Plan |
|---|-------|--------|------|
| 0 | Bootstrap: docs, tooling, `just check`, empty API + web | done | — |
| 1 | Walking skeleton: `GET /v1/ruleset` from Postgres → shown on a web page; deploy scripts written | done | — |
| 2 | Plugin API: game-server endpoints, server keys, idempotent run ingest, PB upkeep, replay-wanted + presigned upload, contract tests | done | — |
| 3 | Design system: tokens, fonts, primitives, layout shell, motion set, `/dev/ui` style guide | done | — |
| 4 | Players & sign-in: Steam OpenID, sessions, privileges, `/players/{steamid64}` | done | — |
| 5 | Maps & leaderboards: map pages, per-style leaderboards, `RunDialog` + `/runs/{id}`, WR history, legacy badge | done | — |
| 6 | Servers & community: listed servers from heartbeats; posts and videos by authorized players (out of the header for now, lead 2026-10-28) | done | — |
| 7 | Staff tools: ruleset, policies, keys, servers, maps and zones, run invalidation, bans, privileges, posts, staff log | done | — |
| 8 | Replays, maps and zones in the browser: replay backend, map files, the viewer, the zone editor | in progress | `plans/replays-and-maps.md`, `plans/map-bulk-upload.md` |
| 9 | Legacy import into its own tables, and the ban list; legacy views on boards and profiles | done | `plans/legacy.md` |

Next: the public beta at beta.sourcejump.net on a temporary VPS, with Cloudflare R2 for files (ADR 0007, `docs/deploy.md`; the scripts have not run against a server yet).

UI polish from the lead's review (2026-10-19), to do as pages are built: a no-country placeholder that reads as a flag; larger small text (menu labels like "Signed in as", header section links); more micro-animations, e.g. tooltips and the account menu opening. Profiles show per style a points rank (marked draft while the formula is), completed maps and world records (lead, 2026-10-20). Map images are uploaded and stored as fixed WebP sizes in object storage.

Staff area: the lead reviewed it (2026-10-21) and staff tools are moving onto the pages they act on, one area at a time (`docs/plans/staff-rework.md`). When the API is unreachable, pages say "sign in" instead of "can't load" (`signedInPlayer` returns null for both); the first full load shows one large placeholder over the sidebar.


Later, unordered: points and tiers (after the community decides; a Points section on the map's Manage view), map downloads and whether to host FastDL (a cost decision), zone submission and review queues, anti-cheat moderation, ban appeals, key requests by server owners, live records feed (`plans/records-stream.md`), automated run verification, Discord preview images.

Open for the lead: the beta VPS and R2 bucket (`docs/deploy.md`); at the switch, whether beta staff work carries over; approving the API's field names (`api/openapi.json`, `api/contract/`) once plugin work starts, before anything goes to the plugin repo; whether a replay comes with every run, not only personal bests (the poll asked for personal bests); the final DB export at the switch, made like the test dump (`plans/legacy.md`); whether the old plugin endpoints must keep working on the new backend.
