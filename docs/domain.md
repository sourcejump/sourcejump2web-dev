# Domain
What SourceJump's data means, what's decided, and who decides what. Read this before modeling data or writing user-facing text.

## Glossary
| Term | Meaning |
|---|---|
| Bhop | Bunnyhopping: a CS:S movement mode. Players race through custom maps by chaining jumps and air-strafing |
| shavit | shavit's bhoptimer, the SourceMod timer every connected server runs (timing, styles, zones, replays) |
| Run | One timed completion of a map track. Identified by an ID generated on the game server |
| PB / WR | A player's personal best, and the world record (fastest PB), per map + style + track |
| Invalidated run | A run staff took off the boards. It stays stored and can be restored |
| Style | Rule variant with its own leaderboard: normal (autobhop), scroll, sideways (SW), half-sideways (HSW), W-only, A/D-only, backwards (BW), … Identified by a SourceJump **style key**, never a server's style number |
| Ranked style | A style SourceJump defines and ranks. Servers also run fun styles, which are never submitted |
| Track | Main or bonus N. Each has its own leaderboard |
| Zones | Start/end/bonus/glitch boxes that define a run. SourceJump is the source of zones; runs carry a zone fingerprint |
| Tier | Map difficulty rating (not yet defined for 2.0) |
| Replay | shavit's per-tick recording of a run (positions, angles, buttons) |
| Ruleset | Versioned JSON SourceJump serves: required cvars, plugins, ranked styles, zone source, features. Every run carries the ruleset version it was played under |
| API key | One per server at a time; required to submit. Revoking it can invalidate every run the server sent |
| Pre-2.0 / legacy | Records from the old site's database, in the `legacy_*` tables. Shown on the same boards in views you switch to, marked; never part of 2.0 standings |
| BASH | The anti-cheat plugin servers must run; its detections are forwarded to SourceJump |

## Who decides
- **Policy is the community's call** (on Discord, recorded by the project lead): ranked styles, ranked maps, tiers, points, replay retention, what's public. Leave an undecided value open; never invent an answer. Decided rules (the ruleset) and policies are versioned data changed in code, as migrations, not edited on the site; the public `/ruleset` page explains them. Per-map values such as tiers are set by staff on the map's page (lead, 2026-10-21).
- **Technical "how" is ours to propose** (stack, schema, API design), for the lead to accept.
- Anything posted publicly goes through the lead.

## Decided
- CS:S only, shavit only. Anyone can run the plugin; **writes need one API key per server**. Ruleset, zones and records are public.
- **Only personal bests** on ranked styles are submitted: the server skips a run that isn't faster than the player's SourceJump PB, which it reads from the API. Provisional for public testing, the community may still ask for every run (lead, 2026-11-04). The API still decides what a PB is, so a run from a server with a stale PB is stored but changes nothing.
- SourceJump decides which replays it wants: currently **only a new SourceJump PB**. The plugin uploads straight to a presigned URL.
- Every ranked style's replays are public (viewer + download; lead, 2026-11-03). Segmented and TAS: replays kept private (leaning); they aren't ranked styles.
- AC detections are not public (leaning).
- **Existing records are kept as pre-2.0. 2.0 leaderboards start fresh. The ban list carries over.** Pre-2.0 records go in a table of their own; where and how they're shown is decided later (lead, 2026-10-20).
- The map list holds every map with at least one run, with no ranked label until the map pool is decided. Tiers are stored per map and track but stay empty until the community sets them; staff set tiers, map images and descriptions on each map's Manage view (lead, 2026-10-19).
- Every run's details are public, by its ID: player, map, style, track, time, stats, server and ruleset version. Compliance reports and keys are not (lead, 2026-10-19).
- An invalidated run leaves the leaderboards and WR history, and its page says "Invalidated" without the reason; staff reasons are never public (lead, 2026-10-20). It also leaves profiles and public run counts, and the player's next fastest valid run becomes their PB.
- Bans restrict records and/or posting, until lifted or a set date. Staff choose per ban whether existing runs are invalidated (on by default); new runs during a records ban are always stored invalid. Lifting a ban leaves those runs invalid until staff restore them. A posting ban covers posts and run comments, and leaves what was already posted up. Bans aren't public (lead, 2026-10-20).
- Bonus tracks get their own leaderboards (leaning).
- A server holds one API key at a time; a new key replaces the old. Staff count and invalidate runs per server, across its keys (lead, 2026-10-21).
- Server owners request keys on the Discord (a dedicated channel may come nearer rollout); staff issue them and list the server. The help page explains connecting a server and links the plugin repo (lead, 2026-11-10).
- Players sign in with Steam. Staff permissions are bitmaps of privileges and restrictions, for granular control (lead, 2026-10-19). Nobody changes their own privileges; `manage_privileges` is granted only on the server's command line; each change needs a reason (lead, 2026-10-20).
- Profiles show the player's country flag from their public Steam profile, with a placeholder hinting them to set one. Steam data comes from the public profile XML, not the Steam Web API (lead, 2026-10-19).
- Site navigation never prefetches pages, on hover or in view (lead, 2026-10-19).
- Every server running the plugin reports itself every 10 minutes, with or without a key. The site lists only servers staff have listed, a whitelist separate from keys, so nobody can fill it by starting servers or changing IPs. Public per server: hostname, address, map, players, online, and whether it's connected (has a valid key); compliance details stay staff-only for now. The Servers page charts players online over 24 hours, 7 days, a month and a year (lead, 2026-10-20).
- The Community page holds posts by players staff allow to post: articles, and videos as links to YouTube, nothing embedded. More kinds can follow. Staff can edit or remove any post, with a reason for someone else's; removed posts are kept, hidden. Staff can restore what staff removed, not what an author removed (lead, 2026-10-20).

## Open (keep configurable)
- A curated ranked map pool vs. all maps ranked; map review workflow.
- Tier count and who assigns tiers (bonuses get their own tier).
- Points formula. Strong preference: separate points and completions per style, with no style affecting another. A draft is shown, marked as one, until the community decides (`docs/site-api.md`; lead, 2026-10-26).
- Ranked styles, their shavit settings and the landfix. Public testing runs on provisional values (migrations 0041–0042: normal, scroll, HSW, SW, A/D-only, W-only, 400 Velocity, Low Gravity, Autosync; landfix on all but Scroll and 400 Velocity), revised with the community from there (lead, 2026-11-04). BW has no definition yet.
- Whether a keyless server's queued runs can be imported once approved.
- Zone submission and approval; run verification from replays; how AC detections feed moderation.
- Whether non-compliant servers show as such on the public server list.
- Which tickrate runs are ranked at. The ruleset's `tickrate` stays null (any) until it's decided.
- Whether superseded PB replays are kept.

## Plugin contract
The plugin (github.com/sourcejump/plugins, daf's, private until it opens) is the API's first client. The API is designed here, for what makes the best backend and site, and the plugin follows it (its `docs/plugin-api.md`; lead, 2026-10-19). Community decisions are recorded in this file and bind the API.
