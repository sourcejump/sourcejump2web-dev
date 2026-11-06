import { describe, expect, it } from "vitest";
import { MAP_NAME } from "./mapName";

describe("MAP_NAME", () => {
  it("takes the names the API takes", () => {
    for (const name of ["bhop_badges", "bhop_arcane_v1.2", ".bhop."])
      expect(MAP_NAME.test(name), name).toBe(true);
  });

  it("refuses names that are paths, spaces or too long", () => {
    for (const name of [
      ".",
      "..",
      "...",
      "../etc",
      "bhop badges",
      "",
      "a".repeat(65),
    ])
      expect(MAP_NAME.test(name), name).toBe(false);
  });
});
