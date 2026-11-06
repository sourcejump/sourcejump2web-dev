-- Each board's records in WR history's order, so recounting record-when-set finds the board's best before a
-- run with one lookup instead of reading every earlier run (`leaderboards/world_records.rs`). Records are a
-- small share of runs, so the index stays small.
CREATE INDEX runs_board_records ON runs (map_id, style, track, finished_at, id) WHERE was_record;
