-- Which bans are in force, spelled out once, so every query that leaves banned players out reads the same rule
-- (external audit, 2026-11-06). Views rather than functions: the planner folds a view into the query, so
-- `NOT EXISTS (SELECT 1 FROM records_bans ...)` over a whole board still runs as one anti-join, where a
-- function holding the subquery would be called once per row.

-- A ban is active until it's lifted or its end passes.
CREATE VIEW active_bans AS
    SELECT * FROM bans WHERE lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now());

-- Active bans that keep the player off the boards: bit 0 is `no_records` (restrictions.rs).
CREATE VIEW records_bans AS
    SELECT * FROM active_bans WHERE restrictions & 1 <> 0;
