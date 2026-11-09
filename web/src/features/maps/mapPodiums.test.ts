// PBs use the selected style and viewer, and a failed lookup must not look like an uncompleted map.
import { beforeEach, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { mapPodiums } from "./mapPodiums";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { GET: get } }));

const entry = {
  rank: 5,
  player: { name: "Runner", steamid64: "76561198000000001" },
  time: 12,
  run_id: 73,
};
const record = {
  ...entry,
  rank: 1,
  time: 10,
  run_id: 70,
  player: { name: "Leader", steamid64: "76561198000000003" },
};
const map: Schemas["MapSummary"] = {
  name: "bhop_test",
  players: 10,
  bonuses: 0,
  last_run_at: "2026-11-09T00:00:00Z",
  world_record: { ...record, finished_at: "2026-11-09T00:00:00Z" },
};

beforeEach(() => {
  get.mockReset();
});

it("loads the viewer's PB in the same style-scoped request as the podium", async () => {
  get.mockResolvedValue({ data: { entries: [record], player_entry: entry } });
  const result = await mapPodiums([map], "scroll", entry.player.steamid64);
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0]![1].params.query).toEqual({
    style: "scroll",
    track: 0,
    limit: 3,
    player: entry.player.steamid64,
  });
  expect(result.get(map.name)?.personalBest).toEqual(entry);
  expect(result.get(map.name)?.entries).toEqual([record]);
});

it("scopes each viewer independently and omits PBs for signed-out visitors", async () => {
  get.mockImplementation(async (_path, options) => ({
    data: {
      entries: [record],
      player_entry:
        options.params.query.player === entry.player.steamid64 ? entry : null,
    },
  }));
  expect(
    (await mapPodiums([map], "normal", entry.player.steamid64)).get(map.name)
      ?.personalBest,
  ).toEqual(entry);
  expect(
    (await mapPodiums([map], "normal", "76561198000000002")).get(map.name)
      ?.personalBest,
  ).toBeNull();
  expect(
    (await mapPodiums([map], "normal")).get(map.name)?.personalBest,
  ).toBeUndefined();
});

it("distinguishes an empty style from a failed request", async () => {
  const empty = await mapPodiums(
    [{ ...map, world_record: null }],
    "normal",
    entry.player.steamid64,
  );
  expect(empty.get(map.name)?.personalBest).toBeNull();
  expect(get).not.toHaveBeenCalled();
  get.mockRejectedValue(new Error("unreachable"));
  expect(
    (await mapPodiums([map], "normal", entry.player.steamid64)).get(map.name),
  ).toBeNull();
});
