-- Each player's valid runs newest first, so the player list finds every listed player's latest run and counts
-- their runs over the last 30 days without reading all of their runs (`players/list.rs`).
CREATE INDEX runs_player_latest ON runs (player_steamid64, finished_at DESC, id DESC) WHERE invalidated_at IS NULL;
