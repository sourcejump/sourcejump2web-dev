// The text of a run page's link preview.
import { describe, expect, it } from "vitest";
import type { Schemas } from "@/api/client";
import { runDescription } from "./runPreview";

const styleName = (key: string) => (key === "normal" ? "Normal" : key);

describe("runDescription", () => {
  const run = {
    time: 74.581,
    style: "normal",
    track: 0,
    invalidated: false,
    rank: 31,
  } as Schemas["RunDetail"];

  it("gives the time, style, track and place", () => {
    expect(runDescription(run, styleName)).toBe(
      "1:14.581 in Normal on the main track. Place 31.",
    );
    expect(runDescription({ ...run, track: 2, rank: null }, styleName)).toBe(
      "1:14.581 in Normal on bonus 2.",
    );
  });

  it("says an invalidated run is invalidated, without a place", () => {
    expect(
      runDescription({ ...run, invalidated: true, rank: null }, styleName),
    ).toBe("1:14.581 in Normal on the main track. Invalidated.");
  });
});
