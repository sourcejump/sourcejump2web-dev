-- Each player's valid runs per map, style and track, fastest first: a profile counts the runs behind each
-- personal best it lists, and lists them when asked (`players/personal_bests.rs`, `players/runs.rs`).
CREATE INDEX runs_player_board ON runs (player_steamid64, map_id, style, track, time) WHERE invalidated_at IS NULL;
