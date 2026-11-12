# Deploy
How an environment (staging, production) is laid out and shipped. Why it works this way: ADR 0005, and 0008 for the tunnel.

## Shape of one environment
One VPS runs everything as systemd services under the `sourcejump` user:
- **cloudflared** carries all web traffic from Cloudflare, which ends TLS, to Caddy on `127.0.0.1:80`. The firewall (ufw) lets in only SSH, rate-limited (6 new connections per 30 s per address); SSH takes keys only. A separate nftables table (`drop-ip-options.service`) drops IPv4 packets carrying IP options, which CVE-2026-98432 needs.
- **Caddy** listens on localhost over plain HTTP. `/v1/*` and `/health` go to the API on `127.0.0.1:8080`; every other path goes to the web app on `127.0.0.1:3000`. One domain serves both, so the plugin and the browser use the same base URL. It sets `X-Forwarded-For` to Cloudflare's `Cf-Connecting-IP`, and security headers on every response (no framing, `nosniff`, referrer policy, HSTS). Template: `deploy/Caddyfile`. The web app's own `/v1` proxy exists only under `next dev`.
- **API**: the static binary at `/opt/sourcejump/api/`. It applies pending migrations when it starts, so a deploy is "copy, restart". Config: `/etc/sourcejump/api.env`, including the object-storage settings (`SJ_S3_*`, with `SJ_S3_PUBLIC_URL` where browsers read public files such as map images); it refuses to start without them.
- **Web**: the Next.js standalone build at `/opt/sourcejump/web/`, run by Node 24. It reaches the API over loopback (`SJ_API_URL`). `just deploy` builds it with `SJ_SITE_URL` from `SITE_ADDRESS`, for link previews' whole addresses. Config: `/etc/sourcejump/web.env`, where `NODE_OPTIONS` caps its heap.
- **Postgres 18**: database and role `sourcejump`, reached over the local socket with peer authentication, so there is no database password. Requests use their own pool of 10 connections, where a statement may run 5 s (`query_time_limit.rs`); startup, jobs and the CLI use one without the limit, and recounts and invalidations lift it. A run being stored waits at most 2 s for another recount, then gets a `500` its server resends (`standings.rs`).

Each environment has a file `deploy/environments/<env>.env` with `SSH_TARGET` (a `Host` alias from your `~/.ssh/config` that logs in as root; server addresses stay out of the repo), `SITE_ADDRESS` (the domain) and optionally `NOINDEX=true`, which makes Caddy send `X-Robots-Tag: noindex, nofollow` on every response. These hold no secrets and are committed.

## Environments (lead, 2026-10-28)
- `beta`: the public beta at beta.sourcejump.net, on a temporary VPS, kept out of search engines. Its data is wiped at the switch; whether staff work there (zones, tiers, pictures, viewer files) carries over is decided then.
- Production: at the switch, the old site's VPS is rebuilt with `just provision` and takes over sourcejump.net; the beta VPS then goes away. Open for then: downtime while it's rebuilt, and the old plugins, which post to the old API.

## Commands
- `just provision <env>`: one time per server. Installs Postgres, Caddy, Node and cloudflared from their official apt repositories, closes everything but SSH, sizes Postgres for a small box and creates the user, database and env files. Safe to rerun; it never overwrites existing env files. Then connect the tunnel (below) and fill in `api.env`.
- `just deploy` builds the API's static binary, which needs `musl-gcc` on this machine: `sudo apt install musl-tools`.
- `just deploy <env>`: builds on this machine, copies the build, units and Caddyfile, restarts both services, then checks `https://<site>/health` and `/`. It fails loudly if either doesn't answer within a minute.
- Logs: `journalctl -u sourcejump-api -u sourcejump-web` on the server.
- Issue or revoke a server's API key: `ssh <target> 'set -a; . /etc/sourcejump/api.env; /opt/sourcejump/api/sourcejump-api keys issue "<server name>"'` (or `keys revoke <prefix>`). The key is printed once.
- Discord record feeds (`record_events/discord.rs`): put the feeds JSON at `/etc/sourcejump/discord-feeds.json` (owned by `sourcejump`, mode 600: its webhook URLs are secrets) and set `SJ_DISCORD_FEEDS` to that path in `api.env`. Each entry is `{"name", "records"?: "world_records" | "personal_bests", "style"?, "min_tier"?, "max_tier"?, "untiered"?, "bonuses"?, "webhook"}`; the lead keeps the current file. Without it nothing is posted. A feed's first start posts only records from then on. The tier icons next to map names are `web/public/tiers/` (`scripts/tier-icons.py`).
- Discord map-edits feed (`staff/map_edits.rs`): set `SJ_DISCORD_MAP_EDITS` in `api.env` to the channel's webhook URL (a secret). Staff changes to tiers, pictures and zones made on the site are posted there, one message per map and staff member, under their name and Steam avatar, once they've stopped editing it for two minutes; command-line imports aren't. Without it nothing is posted.
- Rollback: check out the previous commit and deploy it. Migrations are additive, so the older binary still runs on the newer schema; binaries from 2026-11-05 on start despite migrations they don't know. Before that, they refused: restore the backup instead. Migration 0051 dropped a column that older binaries read, so rolling back past it means restoring the backup taken before it.
- Sample data on staging: `ssh <target> 'runuser -u sourcejump -- psql sourcejump' < api/seed/dev.sql`. Never on production.

## Gotchas
- Builds use the committed sqlx query cache (`api/.sqlx`), so a schema change needs `just openapi` (which reruns `cargo sqlx prepare`) before it deploys. `just check` catches a stale cache.
- Tunnel, once per server: Zero Trust > Networks > Tunnels > Create (Cloudflared). Copy the token from the install command, then `ssh <target> cloudflared service install <token>`. Add a published application route: the site's hostname to `http://127.0.0.1:80`. Cloudflare creates the DNS record; don't add one by hand.
- The SSH rate limit counts every connection, and a deploy opens several. Reuse one with `ControlMaster auto` and `ControlPersist` for the host in `~/.ssh/config`.
- `/opt` is read-only to the services except the web app's `.next/cache`.

## Object storage: Cloudflare R2 (ADR 0007)
Two buckets from the beta on. `sourcejump` is public by design: keys carry a random part, so only the API says where a file is (`docs/api.md`). `sourcejump-staging` is private: staff and game server uploads (viewer files, replays) wait there until the API checks them, so it never gets a custom domain or r2.dev access. Set up once, in the Cloudflare dashboard:
1. R2 > Create buckets `sourcejump` and `sourcejump-staging`. Then Manage API tokens > Create: permission Object Read & Write, applied to those two buckets only. Note the access key ID and secret; they're shown once.
2. Bucket > Settings > Custom Domains > Add `files.sourcejump.net`. Not r2.dev, which is rate-limited and uncached.
3. Bucket > Settings > CORS Policy > JSON, for the replay viewer (`docs/replay-viewer.md`); add sourcejump.net at the switch:
   `[{"AllowedOrigins": ["https://beta.sourcejump.net"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["Content-Range", "Content-Length"], "MaxAgeSeconds": 86400}]`
   For `sourcejump-staging`, staff pages upload straight to it (game servers upload replays there too, without CORS):
   `[{"AllowedOrigins": ["https://beta.sourcejump.net"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400}]`
   and under Object lifecycle rules, delete objects 1 day after upload, so abandoned uploads go.
4. Caching > Cache Rules: for hostname `files.sourcejump.net`, eligible for cache. By default Cloudflare caches only some file types, not `.sjr`, `.bsp` or `.vpk`; the files' own `Cache-Control` sets how long.
5. On the server, in `/etc/sourcejump/api.env`: `SJ_S3_ENDPOINT=https://<account ID>.r2.cloudflarestorage.com`, `SJ_S3_REGION=auto`, `SJ_S3_BUCKET=sourcejump`, `SJ_S3_STAGING_BUCKET=sourcejump-staging`, the token's key ID and secret, `SJ_S3_PUBLIC_URL=https://files.sourcejump.net`. Uploads are presigned against the endpoint, not the custom domain.
6. Upload CS:S's stock VPKs (about 3.2 GB, once) from a machine with CS:S installed: `cd api && cargo run -- maps stock-content <CS:S folder>` with the five `SJ_S3_*` values from step 5 set in that shell only. It needs no database and skips files already stored.
7. Check on the beta that a replay's map loads through the custom domain: viewer files are stored brotli-encoded (`Content-Encoding: br`), which Cloudflare's cache must pass through unchanged.

At the switch, empty the bucket (R2 > bucket > Delete objects, or the S3 API; deletes are free) unless staff work is carried over.

## Not set up yet
Nightly `pg_dump` to the bucket, and uptime checks.
