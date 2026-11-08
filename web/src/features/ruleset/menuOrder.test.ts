// The menus' style order.
import { describe, expect, it } from "vitest";
import { menuOrder } from "./menuOrder";

describe("style menu order", () => {
  it("lists Autosync right after Normal", () => {
    expect(menuOrder(["normal", "scroll", "hsw", "autosync"])).toEqual([
      "normal",
      "autosync",
      "scroll",
      "hsw",
    ]);
  });

  it("keeps the ruleset's order without Normal first or without Autosync", () => {
    expect(menuOrder(["scroll", "autosync"])).toEqual(["scroll", "autosync"]);
    expect(menuOrder(["normal", "scroll"])).toEqual(["normal", "scroll"]);
    expect(menuOrder(["normal", "autosync", "scroll"])).toEqual([
      "normal",
      "autosync",
      "scroll",
    ]);
  });
});
