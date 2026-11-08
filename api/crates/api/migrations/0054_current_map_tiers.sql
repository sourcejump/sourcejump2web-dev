-- The tier in force per map and track: the newest assignment in `map_tiers`, which is append-only history.
-- Queries read this instead of each repeating "newest first, take one" (14 copies before it). Conditions on
-- map_id and track reach the primary key through the view, so one map's or track's lookup still reads only its
-- own rows. It says nothing of whether tiers are in force yet (the `tiers` policy); callers still decide that.
CREATE VIEW current_map_tiers AS
SELECT DISTINCT ON (map_id, track) map_id, track, tier, assigned_at, assigned_by
FROM map_tiers
ORDER BY map_id, track, assigned_at DESC;
