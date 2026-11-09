// Public main-track podiums for the map cards, cached briefly and fetched in bounded batches.
import { cacheLife } from "next/cache";
import { api, type Schemas } from "@/api/client";

export type MapLeader = Pick<
  Schemas["LeaderboardEntry"],
  "rank" | "player" | "time" | "run_id"
>;

export async function mapPodiums(
  maps: Schemas["MapSummary"][],
  style: string | null | undefined,
): Promise<Map<string, readonly MapLeader[] | null>> {
  const podiums = new Map<string, readonly MapLeader[] | null>();
  if (!style) return podiums;
  // Avoid issuing a page's worth of independent requests to the beta API at once.
  for (let offset = 0; offset < maps.length; offset += 6) {
    const batch = await Promise.all(
      maps.slice(offset, offset + 6).map(async (map) => {
        if (!map.world_record) return [map.name, []] as const;
        const leaders = await cachedPodium({
          map: map.name,
          style,
          record: map.world_record.run_id,
        }).catch(() => null);
        return [map.name, leaders] as const;
      }),
    );
    for (const [map, leaders] of batch) podiums.set(map, leaders);
    if (batch.every(([, leaders]) => leaders === null)) break;
  }
  return podiums;
}

async function cachedPodium(key: {
  map: string;
  style: string;
  // A new WR changes the key, so cached cards cannot contradict the map list's winner.
  record: number;
}): Promise<MapLeader[]> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  const { data, response } = await api.GET("/v1/maps/{map}/leaderboard", {
    params: {
      path: { map: key.map },
      query: { style: key.style, track: 0, limit: 3 },
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!data) throw new Error(`Map podium answered ${response.status}`);
  return data.entries.map(({ rank, player, time, run_id }) => ({
    rank,
    player,
    time,
    run_id,
  }));
}
