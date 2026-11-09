// Local beta playback must proxy only the public file host and leave deployed asset URLs alone.
import { afterEach, expect, it, vi } from "vitest";
import { replayAssetUrl } from "./assetUrl";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("proxies beta assets locally, preserving paths and queries", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  expect(replayAssetUrl("https://files.sourcejump.net/stock/css-v1/?v=2")).toBe(
    "http://localhost:3000/_beta-files/stock/css-v1/?v=2",
  );
  expect(replayAssetUrl("http://localhost:3900/maps/test.bsp")).toBe(
    "http://localhost:3900/maps/test.bsp",
  );
  expect(
    replayAssetUrl("https://files.sourcejump.net.example.com/run.sjr"),
  ).toBe("https://files.sourcejump.net.example.com/run.sjr");
});

it("keeps deployed playback direct", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(replayAssetUrl("https://files.sourcejump.net/replays/test.sjr")).toBe(
    "https://files.sourcejump.net/replays/test.sjr",
  );
});
