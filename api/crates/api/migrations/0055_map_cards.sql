-- Each map's link card: the picture link previews show for its page, drawn from its cover, name and tier
-- (`maps/card.rs`). A job keeps one card per map with a cover and deletes the one it replaces, so they never pile
-- up. No foreign key to maps, as with standings_boards: checking one locks the map's row, which the ingest can
-- hold for as long as a standings recount takes.
CREATE TABLE map_cards (
    map_id bigint PRIMARY KEY,
    -- The stored JPEG, named by its content.
    key text NOT NULL UNIQUE CHECK (key ~ '^maps/[a-z0-9_.-]+/card-[0-9a-f]{12}\.jpg$'),
    -- What it was drawn from (design version, cover and tier); a card whose inputs changed is drawn again.
    made_from text NOT NULL,
    made_at timestamptz NOT NULL DEFAULT now()
);

-- The job sleeps until a card may be out of date, and these wake it: a map's pictures change (the first is the
-- cover), a main track's tier is set, or a tier count is published. Triggers rather than calls in the code, so
-- every way of changing these (site, CLI, imports) wakes it. Postgres sends a notification only once its
-- transaction commits and merges identical ones within it; the job takes every waiting one per wake-up, so a
-- burst (a picture import) costs a pass or two.
CREATE FUNCTION map_cards_wake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('map_cards', '');
    RETURN NULL;
END
$$;

CREATE TRIGGER map_images_wake_map_cards AFTER INSERT OR UPDATE OR DELETE ON map_images
    FOR EACH STATEMENT EXECUTE FUNCTION map_cards_wake();
CREATE TRIGGER map_tiers_wake_map_cards AFTER INSERT ON map_tiers
    FOR EACH ROW WHEN (NEW.track = 0) EXECUTE FUNCTION map_cards_wake();
CREATE TRIGGER policies_wake_map_cards AFTER INSERT ON policies
    FOR EACH ROW WHEN (NEW.name = 'tiers') EXECUTE FUNCTION map_cards_wake();
