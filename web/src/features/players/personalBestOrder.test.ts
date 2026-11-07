import { describe, expect, it } from "vitest";
import { gapOf, sortedPbs } from "./personalBestOrder";

const pb = (
  map: string,
  time: number,
  rank: number | null,
  world_record_time: number | null,
  finished_at: string | null = "2026-11-05T10:00:00Z",
) => ({
  map,
  time,
  rank,
  world_record_time,
  finished_at,
  style: "normal",
  track: 0,
  legacy: rank === null,
  run_id: 1,
  tier: null,
});

const behind = pb("bhop_b", 20, 3, 18);
const record = pb("bhop_a", 10, 1, 10);
const legacy = pb("bhop_c", 30, null, null, null); // pre-2.0: no place, gap or date
const list = [behind, record, legacy];
const name = (key: string) => key;

describe("profile personal best order", () => {
  it("measures each gap against its board's record", () => {
    expect(gapOf(behind)).toBe(2);
    expect(gapOf(record)).toBe(0);
    expect(gapOf(legacy)).toBeNull();
  });

  it("sorts by place, with a pre-2.0 run last whichever way", () => {
    const up = sortedPbs(list, { key: "place", descending: false }, name);
    expect(up.map((p) => p.map)).toEqual(["bhop_a", "bhop_b", "bhop_c"]);
    const down = sortedPbs(list, { key: "place", descending: true }, name);
    expect(down.map((p) => p.map)).toEqual(["bhop_b", "bhop_a", "bhop_c"]);
  });

  it("sorts by time and by map", () => {
    const time = sortedPbs(list, { key: "time", descending: true }, name);
    expect(time.map((p) => p.map)).toEqual(["bhop_c", "bhop_b", "bhop_a"]);
    const map = sortedPbs(list, { key: "map", descending: false }, name);
    expect(map.map((p) => p.map)).toEqual(["bhop_a", "bhop_b", "bhop_c"]);
  });
});
