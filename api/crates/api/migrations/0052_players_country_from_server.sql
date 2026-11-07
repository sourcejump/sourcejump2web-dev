-- Whether `players.country_code` came from a game server: its GeoIP lookup of the player's address, sent with a
-- run. A player's country has one source at a time, so this and `country_chosen` are never both true. Which
-- source wins is in `docs/site-api.md`.
ALTER TABLE players
    ADD COLUMN country_from_server boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT players_one_country_source CHECK (NOT (country_chosen AND country_from_server));
