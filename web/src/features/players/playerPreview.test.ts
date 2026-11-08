// The text of a player page's link preview.
import { describe, expect, it } from "vitest";
import type { Schemas } from "@/api/client";
import { playerDescription } from "./playerPreview";

describe("playerDescription", () => {
  const player = {
    first_run_at: "2026-10-01T00:00:00Z",
    map_count: 570,
    legacy_maps: 0,
    all_styles: { completed_maps: 120, completed_bonuses: 4, world_records: 3 },
  } as Schemas["PlayerProfile"];

  it("counts finished maps and world records across styles", () => {
    expect(playerDescription(player)).toBe(
      "Finished 120 of 570 maps, with 3 world records, across all styles.",
    );
    expect(
      playerDescription({
        ...player,
        all_styles: { ...player.all_styles, world_records: 0 },
      }),
    ).toBe("Finished 120 of 570 maps, across all styles.");
  });

  it("describes a player with only pre-2.0 records", () => {
    expect(
      playerDescription({ ...player, first_run_at: null, legacy_maps: 1 }),
    ).toBe("Pre-2.0 records on 1 map.");
  });
});
