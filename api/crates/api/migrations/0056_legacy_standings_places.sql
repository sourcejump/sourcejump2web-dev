-- Each legacy standing's rank and place on the two pre-2.0 leaderboards, stored with the totals they follow
-- from. The leaderboards ranked all 6,000 players on every request to show one page (30 ms on the beta,
-- measured 2026-11-10); the standings only change when they're recounted, on a ban, a lift or an import
-- (`leaderboards/standings.rs`), so the recount ranks them once. Equal shown (rounded) points, and equal
-- completions, share a rank; a place is the row's position in the list, names breaking ties.
ALTER TABLE legacy_standings
    ADD COLUMN points_rank integer,
    ADD COLUMN points_place integer,
    ADD COLUMN completed_rank integer,
    ADD COLUMN completed_place integer;

UPDATE legacy_standings s
SET points_rank = placed.points_rank, points_place = placed.points_place,
    completed_rank = placed.completed_rank, completed_place = placed.completed_place
FROM (
    SELECT s.player_steamid64,
           rank() OVER (ORDER BY round(s.points) DESC) AS points_rank,
           row_number() OVER (ORDER BY s.points DESC, lower(p.name), s.player_steamid64) AS points_place,
           rank() OVER (ORDER BY s.completed DESC) AS completed_rank,
           row_number() OVER (ORDER BY s.completed DESC, lower(p.name), s.player_steamid64) AS completed_place
    FROM legacy_standings s JOIN legacy_players p ON p.steamid64 = s.player_steamid64
) placed
WHERE placed.player_steamid64 = s.player_steamid64;

ALTER TABLE legacy_standings
    ALTER COLUMN points_rank SET NOT NULL,
    ALTER COLUMN points_place SET NOT NULL,
    ALTER COLUMN completed_rank SET NOT NULL,
    ALTER COLUMN completed_place SET NOT NULL;

-- The lists are read by place now.
DROP INDEX legacy_standings_by_points;
DROP INDEX legacy_standings_by_completed;
CREATE INDEX legacy_standings_points_place ON legacy_standings (points_place);
CREATE INDEX legacy_standings_completed_place ON legacy_standings (completed_place);

-- Whether a legacy map has any run: completions on the pre-2.0 leaderboards are counted out of these maps.
-- Counting them probed the runs of every map on each request (25 ms). Set by the import, the only writer of
-- legacy runs (`legacy/import.rs`).
ALTER TABLE legacy_maps ADD COLUMN has_runs boolean NOT NULL DEFAULT false;
UPDATE legacy_maps m SET has_runs = true WHERE EXISTS (SELECT 1 FROM legacy_runs r WHERE r.map_id = m.id);
