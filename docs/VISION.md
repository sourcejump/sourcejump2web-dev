# Vision

**Pitch:** SourceJump is the global records database for the Counter-Strike: Source bunnyhop community. Version 2.0 is a new website and API: game servers submit every personal best to it, and players use the site to follow leaderboards, profiles, maps, servers and replays.

**Users:**
- Players: check times and PBs, compare against others, watch replays, see their progress per style.
- Server owners: connect a server, see whether it's authorized (API key) and compliant.
- Staff: manage the ruleset, keys, zones, maps, bans and run validity.
- Plugin and tool developers: read the public API (records, zones, tiered map list).

**Pillars:**
1. **Trustworthy data.** A run is counted once, under the rules it was played with, and can be traced back to its server and key.
2. **One consistent experience.** Every page is built from the same design system; no page invents its own look.
3. **Clean but feature rich.** Dark, calm, information-dense where it matters. Gamified in a professional way: medals, tiers, progress and micro-animations, never childish.
4. **Fast and cheap to run.** One small VPS, files on object storage, nothing heavy in the request path.
5. **The community decides policy.** Rankings, points, ranked maps and styles are data that staff can change, not code.

**Non-goals:**
- Slogans, sales copy and marketing pages.
- Games other than CS:S, and timers other than shavit's bhoptimer.
- SourceJump-hosted game servers (not decided; out of scope for now).
- Reusing code from the legacy site.

**Constraints:**
- Production is one MVPS VPS in Germany: 2 cores, 4 GB RAM, 50 GB NVMe, 7 TB traffic.
- Low running cost.
- Built mostly by AI agents. The code must stay clean and structured enough for future contributors to read and change; docs, types and tests guard it.
- Open source under MIT (`LICENSE`), so no secrets in the repo or its history.
- The plugin is the API's first client. The API is designed here; the plugin adapts to it.

**References:**
- `docs/design/reference.webp`: the direction for look and feel (dark slate, cyan accent, stat cards, medal rows, map cards). Not a target; see `docs/design-system.md`.
- CS:GO KZ community sites: per-tier completions and "% of maps done" on profiles.
- Font: [Geist](https://vercel.com/font). The previous site used [Play](https://fonts.google.com/specimen/Play).
