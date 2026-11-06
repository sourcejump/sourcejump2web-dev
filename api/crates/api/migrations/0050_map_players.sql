-- Players with a personal best on the map, in any style or track. The map list's default sort ranks every map
-- by it, which counted 179k personal bests on each view at the legacy site's size, so it's stored. Recounted
-- wherever personal bests change (`standings::refresh_runs`).
ALTER TABLE maps ADD COLUMN players integer NOT NULL DEFAULT 0 CHECK (players >= 0);

UPDATE maps m SET players = counted.players
FROM (SELECT map_id, count(DISTINCT player_steamid64) AS players FROM personal_bests GROUP BY map_id) counted
WHERE counted.map_id = m.id;
