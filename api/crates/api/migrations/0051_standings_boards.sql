-- Points are no longer stored per personal best. A board's points all follow from two values, its best time
-- and its tier, so those are stored per board instead, as the standings were counted with them. A new world
-- record or tier then moves the stored totals by the change in each player's points, and a full recount writes
-- the totals alone, where it used to rewrite every personal best: 4 of its 4½ minutes at 10× the legacy data
-- (2026-11-06). `leaderboards/standings.rs` keeps the table current; pages work a personal best's points out
-- with `personal_best_points`.

-- Per board (map, style, track) with a personal best: what its points were last counted with. No foreign key
-- to maps: checking one locks the map's row, which the ingest holds while it waits for a recount to finish.
CREATE TABLE standings_boards (
    map_id bigint NOT NULL,
    style text NOT NULL,
    track smallint NOT NULL,
    best double precision NOT NULL,
    -- NULL when the board earns no points: no tier, or tiers not in force.
    tier smallint,
    PRIMARY KEY (map_id, style, track)
);

-- What the current totals were counted with. Before the first count there are no totals to match.
INSERT INTO standings_boards (map_id, style, track, best, tier)
SELECT pb.map_id, pb.style, pb.track, min(pb.time),
       CASE WHEN coalesce((SELECT (formula->>'tiers')::boolean FROM standings_formula), false) THEN
           (SELECT tier FROM map_tiers t WHERE t.map_id = pb.map_id AND t.track = pb.track
            ORDER BY assigned_at DESC LIMIT 1)
       END
FROM personal_bests pb
GROUP BY pb.map_id, pb.style, pb.track;

-- A personal best's points, as the standings count them: from its board's counted best and tier, and the
-- counted formula (`standings_formula`). 0 before the first count.
CREATE FUNCTION personal_best_points(pb_map_id bigint, pb_style text, pb_track smallint, pb_time double precision)
RETURNS double precision
LANGUAGE sql STABLE PARALLEL SAFE
RETURN coalesce((
    SELECT points_for(b.tier, pb_time, b.best, pb_track > 0,
                      (f.formula->>'base')::float8, (f.formula->>'growth_percent')::float8,
                      (f.formula->>'finish_percent')::float8, (f.formula->>'speed_exponent')::float8,
                      (f.formula->>'bonus_percent')::float8)
    FROM standings_boards b CROSS JOIN standings_formula f
    WHERE b.map_id = pb_map_id AND b.style = pb_style AND b.track = pb_track
), 0);

-- Not additive: a binary from before this migration reads this column, so rolling back past it means
-- restoring the backup taken before it, rather than deploying the older build.
ALTER TABLE personal_bests DROP COLUMN points;
