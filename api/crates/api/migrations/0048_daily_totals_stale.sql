-- Days before yesterday whose daily totals changed since they were counted: a run that arrived late, or one
-- invalidated or restored (external audit, 2026-11-06). The job's own pass recounts yesterday and today; it
-- recounts from the earliest day here too, and empties the table. A trigger fills it, so no writer of runs can
-- forget to. Yesterday and today are left out: the pass counts them anyway, and leaving them out keeps the
-- ingest from queueing on one shared row per day.
CREATE TABLE daily_totals_stale (
    day date PRIMARY KEY
);

CREATE FUNCTION runs_mark_daily_totals_stale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- The same day a run counts on in `daily_run_totals`.
    IF NEW.finished_at < ((now() AT TIME ZONE 'UTC')::date - 1)::timestamp AT TIME ZONE 'UTC' THEN
        INSERT INTO daily_totals_stale (day) VALUES ((NEW.finished_at AT TIME ZONE 'UTC')::date)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

-- `was_record` too: a run's day can change who was a record on later days, which those days count.
CREATE TRIGGER runs_daily_totals_stale
    AFTER INSERT OR UPDATE OF invalidated_at, was_record ON runs
    FOR EACH ROW EXECUTE FUNCTION runs_mark_daily_totals_stale();

-- A day's world records are its runs stored as records when set (`leaderboards/world_records.rs`), rather
-- than worked out again here.
CREATE OR REPLACE FUNCTION daily_run_totals(since timestamptz)
RETURNS TABLE (day date, runs integer, world_records integer)
LANGUAGE sql STABLE AS $$
    SELECT (LEAST(finished_at, now()) AT TIME ZONE 'UTC')::date, count(*)::integer,
           (count(*) FILTER (WHERE was_record))::integer
    FROM runs
    WHERE invalidated_at IS NULL AND finished_at >= since
    GROUP BY 1
$$;
