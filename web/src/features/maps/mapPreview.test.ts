// The text of a map page's link preview.
import { describe, expect, it } from "vitest";
import type { Schemas } from "@/api/client";
import { mapDescription } from "./mapPreview";

const names: Record<string, string> = { normal: "Normal", sw: "Sideways" };
const styleName = (key: string) => names[key] ?? key;
const gabe = {
  steamid64: "76561197960287930",
  name: "gabe",
  avatar_url: null,
  country_code: null,
};

function board(style: string, time: number) {
  return {
    style,
    players: 1,
    runs: 1,
    world_record: { player: gabe, time, run_id: 1, finished_at: "" },
    leaderboard: [],
    next_cursor: null,
    wr_history: [],
  };
}

function map(overrides: Partial<Schemas["MapDetail"]>): Schemas["MapDetail"] {
  return {
    name: "bhop_badges",
    images: [],
    players: 44,
    runs: 90,
    tier_count: null,
    tracks: [],
    legacy_players: 0,
    legacy_runs: 0,
    all_players: 0,
    legacy_record_history: [],
    ...overrides,
  } as Schemas["MapDetail"];
}

describe("mapDescription", () => {
  it("names the tier, the opening board's record and the players", () => {
    const tracks = [
      { track: 0, tier: 5, styles: [board("sw", 80), board("normal", 64.211)] },
      { track: 1, tier: null, styles: [board("normal", 10)] },
    ];
    expect(
      mapDescription(
        map({ tracks, tier_count: 10 }),
        ["normal", "sw"],
        styleName,
      ),
    ).toBe(
      "Tier 5. World record 1:04.211 by gabe in Normal. 44 players, 1 bonus.",
    );
  });

  it("leaves out tiers until a tier count is published", () => {
    const tracks = [{ track: 0, tier: 5, styles: [board("normal", 30)] }];
    expect(mapDescription(map({ tracks }), ["normal"], styleName)).toBe(
      "World record 30.000 by gabe in Normal. 44 players.",
    );
  });

  it("says when a map has only pre-2.0 records", () => {
    expect(
      mapDescription(
        map({ players: 0, legacy_players: 3 }),
        ["normal"],
        styleName,
      ),
    ).toBe("Pre-2.0 records only. 0 players.");
  });
});
