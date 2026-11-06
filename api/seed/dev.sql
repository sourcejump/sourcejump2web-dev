-- Development sample data, loaded by `just db`. Never run against production.
-- The ruleset values are a draft from the plugin's first design; none of them is community policy.
-- Style settings are left empty here; migration 0041 adds the provisional ones to databases that already had a ruleset.
INSERT INTO rulesets (version, document) VALUES (1, '{
  "plugin": { "min_version": "0.0.0" },
  "cvars": {
    "sv_allow_wait_command": "0",
    "sv_cheats": "0",
    "shavit_zones_box_offset": "0",
    "shavit_zones_json_enable": "1"
  },
  "plugins": {
    "required": [
      { "name": "shavit", "versions": [] },
      { "name": "bash", "versions": [] }
    ],
    "forbidden": []
  },
  "styles": [
    { "key": "normal", "name": "Normal", "settings": {} },
    { "key": "scroll", "name": "Scroll", "settings": {} },
    { "key": "hsw", "name": "Half-Sideways", "settings": {} },
    { "key": "sw", "name": "Sideways", "settings": {} },
    { "key": "ad-only", "name": "A/D-Only", "settings": {} },
    { "key": "w-only", "name": "W-Only", "settings": {} },
    { "key": "bw", "name": "Backwards", "settings": {} }
  ],
  "zones": {
    "source_url": "http://127.0.0.1:8080/v1/maps/{map}/zones",
    "controlled_types": ["start", "end", "bonus", "glitch"]
  },
  "features": {}
}')
ON CONFLICT (version) DO NOTHING;

-- Invented players, maps and runs, so profiles, leaderboards and the Players page have something to show.
-- The SteamID64s are made up, but any such ID may belong to a real Steam account, so these players are marked
-- as fetched in the far future and the API never loads a stranger's Steam profile for them.
INSERT INTO servers (name) SELECT 'Sample server' WHERE NOT EXISTS (SELECT 1 FROM servers WHERE name = 'Sample server');
INSERT INTO server_keys (server_id, prefix, hash)
SELECT id, 'sj_seed0000', sha256('development seed: not a usable key'::bytea) FROM servers WHERE name = 'Sample server'
ON CONFLICT (prefix) DO NOTHING;

INSERT INTO players (steamid64, name, name_seen_at, country_code, steam_profile_fetched_at)
SELECT 76561199900000000 + n, name, now(), country, '9999-12-31'
FROM (VALUES
    (1, 'nova', 'NO'), (2, 'ricochet', 'US'), (3, 'strafe_cat', 'DE'), (4, 'lowgrav', 'SE'),
    (5, 'Ørjan', 'NO'), (6, 'wavedash', 'FI'), (7, 'kite', 'PL'), (8, 'mirage', NULL),
    (9, 'halfpipe', 'GB'), (10, 'zephyr', 'BR'), (11, 'skid', 'RU'), (12, 'plume', NULL)
) AS sample (n, name, country)
ON CONFLICT (steamid64) DO NOTHING;

-- 48 more players, so the busiest leaderboards run to a second page.
INSERT INTO players (steamid64, name, name_seen_at, country_code, steam_profile_fetched_at)
SELECT 76561199900000000 + n, 'sample_' || n, now(),
       (ARRAY['DE', 'US', 'SE', 'FI', 'PL', 'FR', 'CA', NULL])[1 + n % 8], '9999-12-31'
FROM generate_series(13, 60) AS n
ON CONFLICT (steamid64) DO NOTHING;

INSERT INTO maps (name)
SELECT unnest(ARRAY['bhop_forest', 'bhop_badges', 'bhop_monster_jam', 'bhop_eazy', 'bhop_arcane',
                    'bhop_null', 'bhop_lego', 'bhop_cobblestone', 'bhop_ocean', 'bhop_strafe_fix'])
ON CONFLICT (name) DO NOTHING;

-- Each player has run most maps on normal, and some on other styles. Times spread up to 30% above a per-map
-- base, and run dates over the last 60 days, both derived from a hash so reloading gives the same data.
WITH combos AS (
    SELECT p.steamid64, p.name AS player_name, m.id AS map_id, m.name AS map_name, s.style,
           abs(hashtext(p.steamid64::text || m.name || s.style)) AS h
    FROM players p
    CROSS JOIN maps m
    CROSS JOIN (VALUES ('normal'), ('scroll'), ('sw'), ('w-only')) AS s (style)
    WHERE p.steamid64 BETWEEN 76561199900000001 AND 76561199900000060
      AND m.name LIKE 'bhop\_%'
)
INSERT INTO runs (server_id, key_id, server_run_id, player_steamid64, player_name, map_id, style, track, time,
                  jumps, strafes, sync, perfs, avg_velocity, max_velocity, tickrate, finished_at, plugin_version,
                  ruleset_version, zone_fingerprint, compliance)
SELECT k.server_id, k.id, 'seed-' || c.steamid64 || '-' || c.map_name || '-' || c.style, c.steamid64,
       c.player_name, c.map_id, c.style, 0,
       round(((20 + length(c.map_name) * 4) * (CASE c.style WHEN 'normal' THEN 1 ELSE 1.4 END)
              * (1 + (c.h % 1000) / 3333.0))::numeric, 3),
       30 + c.h % 40, 100 + c.h % 150, 85 + (c.h % 140) / 10.0, 70 + (c.h % 250) / 10.0,
       950 + c.h % 300, 1800 + c.h % 900, 100,
       now() - make_interval(mins => (c.h % 86400)::int),
       '0.0.0', 1, 'seed', '{"compliant": true, "problems": []}'
FROM combos c
CROSS JOIN (SELECT id, server_id FROM server_keys WHERE prefix = 'sj_seed0000') k
-- Most players run normal on most maps; fewer run the other styles. The first 12 play more than the rest.
WHERE (c.style = 'normal' AND c.h % 10 < CASE WHEN c.steamid64 <= 76561199900000012 THEN 8 ELSE 5 END)
   OR (c.style <> 'normal' AND c.h % 10 < CASE WHEN c.steamid64 <= 76561199900000012 THEN 3 ELSE 1 END)
ON CONFLICT (server_id, server_run_id) DO NOTHING;

-- Bonus runs: tracks 1 and 2 on some maps, on normal.
INSERT INTO runs (server_id, key_id, server_run_id, player_steamid64, player_name, map_id, style, track, time,
                  jumps, strafes, sync, perfs, avg_velocity, max_velocity, tickrate, finished_at, plugin_version,
                  ruleset_version, zone_fingerprint, compliance)
SELECT r.server_id, r.key_id, r.server_run_id || '-bonus' || b.track, r.player_steamid64, r.player_name, r.map_id,
       'normal', b.track, round((r.time * (0.15 + b.track * 0.1))::numeric, 3), r.jumps / 4, r.strafes / 4,
       r.sync, r.perfs, r.avg_velocity, r.max_velocity, r.tickrate, r.finished_at - interval '3 hours',
       r.plugin_version, r.ruleset_version, r.zone_fingerprint, r.compliance
FROM runs r
CROSS JOIN (VALUES (1), (2)) AS b (track)
JOIN maps m ON m.id = r.map_id
WHERE r.server_run_id LIKE 'seed-%-normal' AND r.track = 0
  AND abs(hashtext(m.name)) % 3 >= b.track
  AND abs(hashtext(r.server_run_id || b.track)) % 2 = 0
ON CONFLICT (server_id, server_run_id) DO NOTHING;

-- Older, slower attempts before each normal run, so WR history has records that were later beaten.
INSERT INTO runs (server_id, key_id, server_run_id, player_steamid64, player_name, map_id, style, track, time,
                  jumps, strafes, sync, perfs, avg_velocity, max_velocity, tickrate, finished_at, plugin_version,
                  ruleset_version, zone_fingerprint, compliance)
SELECT r.server_id, r.key_id, r.server_run_id || '-early' || a.n, r.player_steamid64, r.player_name, r.map_id,
       r.style, r.track, round((r.time * (1 + a.n * (0.02 + abs(hashtext(r.server_run_id)) % 50 / 1000.0)))::numeric, 3),
       r.jumps + a.n, r.strafes + a.n * 5, r.sync - a.n, r.perfs - a.n, r.avg_velocity - a.n * 20,
       r.max_velocity - a.n * 40, r.tickrate,
       r.finished_at - make_interval(days => a.n * (5 + abs(hashtext(r.server_run_id)) % 20)),
       r.plugin_version, r.ruleset_version, r.zone_fingerprint, r.compliance
FROM runs r
CROSS JOIN (VALUES (1), (2), (3)) AS a (n)
WHERE r.server_run_id LIKE 'seed-%-normal' AND r.track = 0
ON CONFLICT (server_id, server_run_id) DO NOTHING;

INSERT INTO personal_bests (player_steamid64, map_id, style, track, run_id, time, finished_at)
SELECT DISTINCT ON (player_steamid64, map_id, style, track) player_steamid64, map_id, style, track, id, time,
       finished_at
FROM runs WHERE server_run_id LIKE 'seed-%' AND invalidated_at IS NULL
ORDER BY player_steamid64, map_id, style, track, time, finished_at
ON CONFLICT DO NOTHING;

UPDATE maps SET last_run_at = (SELECT max(finished_at) FROM runs WHERE runs.map_id = maps.id),
                listed_at = (SELECT min(received_at) FROM runs WHERE runs.map_id = maps.id);

-- Sample tiers so pages show them in development. The count matches the 10 tiers staff use for now; every tier
-- here is made up.
INSERT INTO policies (name, version, value) VALUES ('tiers', 1, '{"count": 10}') ON CONFLICT DO NOTHING;
INSERT INTO map_tiers (map_id, track, tier, assigned_at)
SELECT m.id, t.track, 1 + abs(hashtext(m.name || t.track)) % 10, '2026-01-01'
FROM maps m
CROSS JOIN (VALUES (0), (1), (2)) AS t (track)
WHERE m.name LIKE 'bhop\_%' AND (t.track = 0 OR abs(hashtext(m.name)) % 3 >= t.track)
ON CONFLICT DO NOTHING;

-- Sample servers for the server list, one per state it shows. Addresses are from the documentation ranges
-- (RFC 5737), so none is a real server. Heartbeat times are relative to loading, so `just db` freshens them.
INSERT INTO server_heartbeats (ip, port, server_id, report, received_at)
SELECT s.ip::inet, s.port, CASE WHEN s.keyed THEN (SELECT id FROM servers WHERE name = 'Sample server') END,
       jsonb_build_object(
           'port', s.port, 'ip', NULL, 'hostname', s.hostname, 'map', s.map,
           'players', s.players, 'max_slots', s.max_slots,
           'plugin_version', '1.0.0', 'sourcemod_version', '1.12.0.7210', 'shavit_version', '4.0.1',
           'ruleset_version', 1, 'plugins', '[]'::jsonb,
           'compliance', jsonb_build_object('compliant', true, 'problems', '[]'::jsonb)),
       now() - s.ago
FROM (VALUES
    ('203.0.113.10', 27015, 'Sample Bhop EU | Easy maps', 'bhop_eazy', 18, 24, true, interval '3 minutes'),
    ('203.0.113.10', 27016, 'Sample Bhop EU | Hard maps', 'bhop_monster_jam', 7, 24, true, interval '8 minutes'),
    ('198.51.100.40', 27015, 'Sample Bhop NA', 'bhop_forest', 3, 32, true, interval '1 minute'),
    ('192.0.2.77', 27015, 'Sample Bhop AU', 'bhop_new_map_v2', 2, 16, false, interval '5 minutes'),
    ('198.51.100.41', 27015, 'Sample Bhop RU', 'bhop_ocean', 0, 24, true, interval '3 hours'),
    ('192.0.2.99', 27015, 'Unlisted test server', 'bhop_lego', 1, 10, false, interval '2 minutes'),
    ('192.0.2.98', 27015, 'Listed, but quiet for days', 'bhop_lego', 0, 10, false, interval '3 days')
) AS s (ip, port, hostname, map, players, max_slots, keyed, ago)
ON CONFLICT (ip, port) DO UPDATE SET report = excluded.report, received_at = excluded.received_at;

INSERT INTO server_listings (ip, port)
VALUES ('203.0.113.10', 27015), ('203.0.113.10', 27016), ('198.51.100.40', 27015), ('192.0.2.77', 27015),
       ('198.51.100.41', 27015), ('192.0.2.98', 27015)
ON CONFLICT DO NOTHING;

-- 30 days of activity for the listed sample servers: a heartbeat every 10 minutes, players following a
-- daily curve peaking at each server's evening, with hash-based noise and an occasional quiet hour.
DELETE FROM server_heartbeat_log WHERE received_at > now() - interval '31 days';
INSERT INTO server_heartbeat_log (ip, port, players, received_at)
SELECT l.ip, l.port,
       least(s.max_slots, greatest(0, round(
           s.peak * (0.55 + 0.45 * cos(2 * pi() * (extract(hour FROM t) + extract(minute FROM t) / 60 - s.evening) / 24))
           + (abs(hashtext(l.ip::text || l.port || t::text)) % 5) - 2)))::smallint,
       t
FROM server_listings l
JOIN (VALUES
    ('203.0.113.10', 27015, 22, 24, 19), ('203.0.113.10', 27016, 10, 24, 20),
    ('198.51.100.40', 27015, 14, 32, 2), ('192.0.2.77', 27015, 6, 16, 9), ('198.51.100.41', 27015, 9, 24, 16)
) AS s (ip, port, peak, max_slots, evening) ON l.ip = s.ip::inet AND l.port = s.port
CROSS JOIN generate_series(now() - interval '30 days', now(), interval '10 minutes') AS t
WHERE abs(hashtext(l.ip::text || l.port || date_trunc('hour', t)::text)) % 40 <> 0
  -- The RU server's last heartbeat above was 3 hours ago.
  AND NOT (l.ip = '198.51.100.41' AND t > now() - interval '3 hours');

-- A year of daily totals: the last 30 days from the log above, earlier days made up with a seasonal swing.
-- The AU server only joined four months ago.
DELETE FROM server_activity_daily;
INSERT INTO server_activity_daily (day, ip, port, players_sum, heartbeats)
SELECT (received_at AT TIME ZONE 'UTC')::date, ip, port, sum(players), count(*)
FROM server_heartbeat_log
GROUP BY 1, 2, 3;
INSERT INTO server_activity_daily (day, ip, port, players_sum, heartbeats)
SELECT d::date, l.ip, l.port,
       144 * greatest(0, round(s.average * (1 + 0.3 * sin(2 * pi() * extract(doy FROM d) / 365))
                               + (abs(hashtext(l.ip::text || l.port || d::text)) % 5) - 2)),
       144
FROM server_listings l
JOIN (VALUES
    ('203.0.113.10', 27015, 16, 365), ('203.0.113.10', 27016, 7, 365), ('198.51.100.40', 27015, 10, 365),
    ('192.0.2.77', 27015, 4, 120), ('198.51.100.41', 27015, 6, 365)
) AS s (ip, port, average, days) ON l.ip = s.ip::inet AND l.port = s.port
CROSS JOIN generate_series(current_date - 365, current_date - 31, interval '1 day') AS d
WHERE d >= current_date - s.days
ON CONFLICT DO NOTHING;

-- Sample community posts by sample players. The video IDs are made up (they open YouTube's "unavailable"
-- page), so no sample links to a real person's video. The texts are placeholders, not announcements. Oldest
-- first, so IDs grow with time as they do for real posts (lists sort by ID).
-- The sample post staff removed (below) is added once with its log entry, so it's kept.
DELETE FROM posts WHERE author_steamid64 BETWEEN 76561199900000001 AND 76561199900000060
  AND id NOT IN (SELECT target::bigint FROM staff_log WHERE action = 'hide_post' AND reason = 'Sample: spam');
INSERT INTO posts (kind, title, body, video_id, author_steamid64, created_at, updated_at)
VALUES
    ('article', 'Hello from the sample data',
     E'A short post, to show how the list looks with one.',
     NULL, 76561199900000002, now() - interval '9 days', now() - interval '9 days'),
    ('video', 'Sideways basics', '',
     'sampleVid02', 76561199900000001, now() - interval '5 days', now() - interval '5 days'),
    ('article', 'Formatting sample',
     E'## A heading\n\nParagraphs with *emphasis*, **bold**, ~~strikethrough~~ and `code`.\n\n> A quote.\n\n1. A numbered list\n2. With two items\n\n<b>Raw HTML</b> shows as text.',
     NULL, 76561199900000003, now() - interval '3 days', now() - interval '3 days'),
    ('video', 'bhop_monster_jam in under two minutes', 'A full run with commentary.',
     'sampleVid01', 76561199900000002, now() - interval '1 day', now() - interval '1 day'),
    ('article', 'Three maps worth trying this week',
     E'A few maps from the list that get less attention than they deserve:\n\n- **bhop_eazy**, a short warm-up\n- **bhop_monster_jam**, long and technical\n- **bhop_forest**, with two bonuses\n\nSee them on the [maps page](/maps).',
     NULL, 76561199900000001, now() - interval '2 hours', now() - interval '2 hours');

-- Sample staff: nova holds every staff privilege (bits 0-7, 9, 10), ricochet only manages maps. The staff log is append-only, so
-- its sample entries are added once, the first time the seed runs on a database.
UPDATE players SET privileges = 1789 WHERE steamid64 = 76561199900000001;
UPDATE players SET privileges = 16 WHERE steamid64 = 76561199900000002;
INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
SELECT actor, action, target, reason, detail::jsonb, now() - age
FROM (VALUES
    (NULL::bigint, 'grant_privileges', '76561199900000001', NULL,
     '{"privileges": ["manage_privileges", "manage_keys", "manage_zones", "manage_maps", "manage_bans", "invalidate_runs", "review_anticheat", "manage_posts", "manage_servers"]}',
     interval '20 days'),
    (76561199900000001, 'grant_privileges', '76561199900000002', 'Helping with map tiers',
     '{"privileges": ["manage_maps", "manage_zones"]}', interval '6 days'),
    (76561199900000001, 'revoke_privileges', '76561199900000002', 'Zones stay with the zone team',
     '{"privileges": ["manage_zones"]}', interval '5 days')
) AS sample (actor, action, target, reason, detail, age)
WHERE NOT EXISTS (SELECT 1 FROM staff_log);

-- Sample invalidations by nova, added once like the log entries above: the normal WR on bhop_badges, and
-- every run of sample_42. Each run records the log entry that took it, and the boards they were on fall back
-- to the next fastest valid run, as the API does.
WITH record AS (
    SELECT pb.run_id, pb.player_steamid64, p.name, pb.style, pb.track, pb.time
    FROM personal_bests pb JOIN maps m ON m.id = pb.map_id JOIN players p ON p.steamid64 = pb.player_steamid64
    WHERE m.name = 'bhop_badges' AND pb.style = 'normal' AND pb.track = 0
    ORDER BY pb.time, pb.run_id LIMIT 1
), logged AS (
    INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
    SELECT 76561199900000001, 'invalidate_run', run_id::text, 'Sample: started outside the start zone',
           jsonb_build_object('player', player_steamid64::text, 'player_name', name, 'map', 'bhop_badges',
                              'style', style, 'track', track, 'time', time),
           now() - interval '2 days'
    FROM record
    WHERE NOT EXISTS (SELECT 1 FROM staff_log WHERE action = 'invalidate_run')
    RETURNING id, target
)
UPDATE runs SET invalidated_at = now() - interval '2 days', invalidated_by = logged.id
FROM logged WHERE runs.id = logged.target::bigint;

WITH logged AS (
    INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
    SELECT 76561199900000001, 'invalidate_player_runs', '76561199900000042', 'Sample: alt account of a banned player',
           jsonb_build_object('runs', count(*)), now() - interval '1 day'
    FROM runs WHERE player_steamid64 = 76561199900000042 AND invalidated_at IS NULL
    HAVING NOT EXISTS (SELECT 1 FROM staff_log WHERE action = 'invalidate_player_runs')
    RETURNING id
)
UPDATE runs SET invalidated_at = now() - interval '1 day', invalidated_by = logged.id
FROM logged WHERE runs.player_steamid64 = 76561199900000042 AND runs.invalidated_at IS NULL;

DELETE FROM personal_bests pb USING runs r WHERE r.id = pb.run_id AND r.invalidated_at IS NOT NULL;
INSERT INTO personal_bests (player_steamid64, map_id, style, track, run_id, time, finished_at)
SELECT DISTINCT ON (player_steamid64, map_id, style, track) player_steamid64, map_id, style, track, id, time,
       finished_at
FROM runs WHERE invalidated_at IS NULL
ORDER BY player_steamid64, map_id, style, track, time, id
ON CONFLICT DO NOTHING;

-- Written above without the API, so each map's player count is recounted here (`maps::count_players`).
UPDATE maps m SET players = (SELECT count(DISTINCT player_steamid64) FROM personal_bests WHERE map_id = m.id);

-- Sample bans, added once: sample_42 (whose runs were invalidated above) from records and posting until
-- lifted, and zephyr's lifted ban from posting. Each ban's log entry is written with it, as the API does.
WITH logged AS (
    INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
    SELECT 76561199900000001, 'ban_player', '76561199900000042', 'Sample: alt account of a banned player',
           '{"restrictions": ["no_records", "no_posting"], "ends_at": null}', now() - interval '1 day'
    WHERE NOT EXISTS (SELECT 1 FROM bans)
    RETURNING id, reason, at
)
INSERT INTO bans (player_steamid64, restrictions, reason, banned_by, banned_at, log_id)
SELECT 76561199900000042, 3, reason, 76561199900000001, at, id FROM logged;

-- Inserted already lifted: a statement can't update a row it inserts.
WITH logged AS (
    INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
    SELECT 76561199900000001, 'ban_player', '76561199900000010', 'Sample: spam in posts',
           '{"restrictions": ["no_posting"], "ends_at": null}', now() - interval '12 days'
    WHERE (SELECT count(*) FROM bans) = 1
    RETURNING id, reason, at
), banned AS (
    INSERT INTO bans (player_steamid64, restrictions, reason, banned_by, banned_at, log_id,
                      lifted_at, lifted_by, lift_reason)
    SELECT 76561199900000010, 2, reason, 76561199900000001, at, id,
           now() - interval '3 days', 76561199900000001, 'Sample: apologised'
    FROM logged
    RETURNING id, lifted_at
)
INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
SELECT 76561199900000001, 'lift_ban', '76561199900000010', 'Sample: apologised',
       jsonb_build_object('ban', id, 'restrictions', '["no_posting"]'::jsonb), lifted_at
FROM banned;

-- Sample removed posts: strafe_cat's own removal, re-added each run like the posts above, and zephyr's spam,
-- which nova removed as staff, added once with its log entry. A statement can't update a row it inserts, so
-- the post is linked to its entry afterwards.
INSERT INTO posts (kind, title, body, author_steamid64, created_at, updated_at, hidden_at, hidden_by)
VALUES ('article', 'Draft posted by mistake', 'Half a post.', 76561199900000003,
        now() - interval '4 days', now() - interval '4 days', now() - interval '4 days', 76561199900000003);

WITH removed AS (
    INSERT INTO posts (kind, title, body, author_steamid64, created_at, updated_at, hidden_at, hidden_by)
    SELECT 'article', 'Cheap boosting service', 'Sample: an advert, as spam looks.', 76561199900000010,
           now() - interval '13 days', now() - interval '13 days', now() - interval '12 days', 76561199900000001
    WHERE NOT EXISTS (SELECT 1 FROM staff_log WHERE action = 'hide_post' AND reason = 'Sample: spam')
    RETURNING id, title
)
INSERT INTO staff_log (actor_steamid64, action, target, reason, detail, at)
SELECT 76561199900000001, 'hide_post', id::text, 'Sample: spam',
       jsonb_build_object('title', title, 'author', '76561199900000010', 'author_name', 'zephyr'),
       now() - interval '12 days'
FROM removed;

UPDATE posts p SET hidden_log_id = l.id
FROM staff_log l
WHERE l.action = 'hide_post' AND l.reason = 'Sample: spam' AND l.target = p.id::text
  AND p.hidden_at IS NOT NULL AND p.hidden_log_id IS NULL;

-- Sample anti-cheat detections from the sample server: 60 for sample_42, enough for a second page on their
-- Manage view, and two for player 3. Idempotent like the ingest, by the server's detection ID.
INSERT INTO anticheat_detections (server_id, key_id, server_detection_id, player_steamid64, player_name, map_id,
                                  message, detected_at, received_at)
SELECT k.server_id, k.id, 'seed-' || d.player || '-' || d.n, d.player, p.name,
       (SELECT id FROM maps ORDER BY id OFFSET d.n % 5 LIMIT 1),
       CASE d.n % 3
           WHEN 0 THEN 'Sample: ' || p.name || ' had perfect strafe timing on ' || (30 + d.n % 10) || ' of 40 strafes'
           WHEN 1 THEN 'Sample: ' || p.name || ' turned at the same angle on ' || (12 + d.n % 8) || ' strafes in a row'
           ELSE 'Sample: ' || p.name || ' gained ' || (90 + d.n % 9) || '% on average over 30 strafes'
       END,
       now() - make_interval(hours => (60 - d.n) * 7), now() - make_interval(hours => (60 - d.n) * 7)
FROM (SELECT 76561199900000042 AS player, generate_series(1, 60) AS n
      UNION ALL SELECT 76561199900000003, generate_series(1, 2)) d
JOIN players p ON p.steamid64 = d.player
CROSS JOIN (SELECT id, server_id FROM server_keys WHERE prefix = 'sj_seed0000') k
-- Oldest first, so IDs grow with time as they do when servers send them.
ORDER BY d.n, d.player
ON CONFLICT (server_id, server_detection_id) DO NOTHING;
