-- The most players online at once across listed servers per UTC day, for the activity chart's year view.
-- Per-server daily averages can't give a cross-server "at once" peak, so heartbeats keep this (see
-- `servers/heartbeat.rs`), and it's kept for 400 days like `server_activity_daily`.
CREATE TABLE server_activity_peaks (
    day date PRIMARY KEY,
    players integer NOT NULL CHECK (players >= 0)
);

-- Back-filled from the 30-day log by the rule `servers/activity.rs` uses up to a month: every 5 minutes, each
-- listed server's latest heartbeat within the last 15 minutes, summed; the day's highest sum.
INSERT INTO server_activity_peaks (day, players)
SELECT (online.at AT TIME ZONE 'UTC')::date, max(online.players)
FROM (
    SELECT m.at, sum(latest.players) AS players
    FROM generate_series(
        date_bin(interval '5 minutes', (SELECT min(received_at) FROM server_heartbeat_log), TIMESTAMPTZ '2000-01-01'),
        now(),
        interval '5 minutes'
    ) AS m(at)
    CROSS JOIN LATERAL (
        SELECT DISTINCT ON (h.ip, h.port) h.players
        FROM server_heartbeat_log h
        JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
        WHERE h.received_at > m.at - interval '15 minutes' AND h.received_at <= m.at
        ORDER BY h.ip, h.port, h.received_at DESC
    ) latest
    GROUP BY m.at
) online
GROUP BY 1;
