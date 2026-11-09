# Web redesign: what the API side needs (plan)

Temporary. What the November 2026 web redesign (branch `feat/mobile-profile-polish`) leaves for the lead on the API
side, and the shortcuts the web takes until then. Delete each item once it's done, and the file when it's empty.

## To merge and deploy

- **PR #16** (`api/profile-and-flags`): player avatars (`GET /v1/players/{player}/avatar`), a player's country from
  the game server that saw them (migration `0052`), the true peak of players online (`0053`), and a personal best's
  tier. The web already uses all four: against beta, avatars 404 and profile tier badges are missing until it ships.
- **Migration numbers:** PR #16 holds `0052` and `0053`. akanora's #26 also chose `0052`; on the integration branch
  it is `0054`, after #16's. Merge #16 first. If #26 is merged upstream on its own as `0052`, #16's two must be
  renumbered after it (sqlx rejects a reused version with different content). This preview keeps its applied
  `0052`–`0054` unchanged; upstream's identical tier view is already `0054`, and its `0053_map_cards` is `0055` here.
- **akanora's PRs #24–#29** (sourcejump/sourcejump), on local branch `integrate/akanora-prs`, one cherry-pick each
  with his authorship, then fixes, then one regenerated spec/types/query cache (commits before it don't build with
  `SQLX_OFFLINE=true`, so it ships whole). `just check` passed (303 Rust tests, web tests) bar the screenshots.
  - #27 Windows build, as submitted. #29 link previews and an error page, as submitted; previews checked.
  - #26 one `current_map_tiers` view for the tier in force; also used by the three copies added since it branched.
    Checked equal to the old lookup on every map and track, untiered ones included.
  - #24 `GET /v1/maps/{map}/personal-bests?players=` (1–64 SteamID64s): each player's PB and rank on every board
    of a map, in one request on map change. Changed to require a server key (401 first), and the 64 limit is
    checked while parsing. **The plugin must send `Authorization` on it.**
  - #28 sign out everywhere: same Origin check as sign-out, ends only that player's sessions. Changed to answer 401
    with no live session, rather than 303 as if it had worked.
  - #25 your own place pinned under a map board's top: needs a signed-in check in a browser, not done yet.

## API additions the web would use

- **Personal bests in place order:** a profile now opens best place first. The API pages personal bests by map
  only, so the web loads every page of a style's 2.0 list on open, 100 a request (shortcut in `PlayerStyles.tsx`).
  A `sort=place` option on `GET /v1/players/{player}/personal-bests` would end that. Pre-2.0 views keep map order,
  since legacy runs have no place.
- **One record per board:** home's "Latest world records" fetches 100 records to find 8 boards (shortcut in
  `LiveNow.tsx`). A `distinct` option on `GET /v1/runs?records=true` would make it exact.
- **Map boards sorted by more than time:** sorting a map leaderboard by jumps, sync or date loads the whole board
  (shortcut in `Leaderboard.tsx`). A `sort` parameter would serve boards with thousands of runs.

## Open questions for the lead

- **Style order:** the Style menus list Autosync right after Normal, a display order in the web
  (`features/ruleset/menuOrder.ts`); the ruleset and the Ruleset page keep the ruleset's order. If the community
  wants that to be the ruleset's own order, that's a ruleset migration, and `menuOrder` can go.

## Practices the redesign settled

- One font, Geist (450 and 700), with Exo 2 bold for server names only (the `font-server` token).
- Phone tables: `Table phoneLead` with a `phoneFill` column sizes the first view to end at the ranked column;
  `Pager` reserves its widest row so turning a page never moves it (`design-system.md`).
- A board's first record shows "(NEW)" where other records show what they took off: `RecentRun.gap` is null only
  for a board's first run, so the API's meaning of a null gap must stay that.
