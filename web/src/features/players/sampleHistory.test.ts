import { afterEach, expect, it, vi } from "vitest";
import { sampleHistory } from "./sampleHistory";

const player = {
  steamid64: "76561199900000002",
  styles: [
    {
      style: "normal",
      main_standing: { rank: 9, points: 43613 },
      bonus_standing: null,
      completed_maps: 10,
      completed_bonuses: 4,
      world_records: 1,
      personal_bests: [],
    },
  ],
};
const now = new Date("2026-11-10T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());

it("provides twelve sample months ending at the mock player's current standing", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SJ_API_URL", "http://127.0.0.1:8080");
  const points = sampleHistory(player, now)!["normal:main"]!;
  expect(points).toHaveLength(12);
  expect(points[0]!.date).toBe("2025-12-01T00:00:00.000Z");
  expect(points.at(-1)).toEqual({
    date: "2026-11-01T00:00:00.000Z",
    rank: 9,
    points: 43613,
  });
});

it("never generates history for real players", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SJ_API_URL", "http://localhost:8080");
  expect(
    sampleHistory({ ...player, steamid64: "76561198000000001" }, now),
  ).toBeUndefined();
});

it("never exposes sample history in production or when using beta data", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(sampleHistory(player, now)).toBeUndefined();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SJ_API_URL", "https://beta.sourcejump.net");
  expect(sampleHistory(player, now)).toBeUndefined();
});
