-- The Discord map-edits feed (`staff/map_edits.rs`): tier, picture and zone changes staff made on the site,
-- queued in the transaction that logs them, so none is lost or posted before it commits. The feed posts a
-- map's queued edits once they've settled and deletes them; without a webhook they're deleted unposted.
CREATE TABLE discord_map_edits (
    log_id bigint PRIMARY KEY REFERENCES staff_log (id)
);
