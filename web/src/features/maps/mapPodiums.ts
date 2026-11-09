// Map-card podiums and the viewer's public PB, cached per style and player in bounded batches.
import { cacheLife } from "next/cache";
import { api, type Schemas } from "@/api/client";

export type MapLeader = Pick<
  Schemas["LeaderboardEntry"],
  "rank" | "player" | "time" | "run_id"
>;

export interface MapPodium {
  entries: readonly MapLeader[];
  personalBest?: MapLeader | null;
}

export async function mapPodiums(
  maps: Schemas["MapSummary"][],
  style: string | null | undefined,
  player?: string,
): Promise<Map<string, MapPodium | null>> {
  const podiums = new Map<string, MapPodium | null>();
  if (!style) return podiums;
  // Avoid issuing a page's worth of independent requests to the beta API at once.
  for (let offset = 0; offset < maps.length; offset += 6) {
    const batch = await Promise.all(
      maps.slice(offset, offset + 6).map(async (map) => {
        if (!map.world_record)
          return [
            map.name,
            { entries: [], personalBest: player ? null : undefined },
          ] as const;
        const leaders = await cachedPodium({
          map: map.name,
          style,
          record: map.world_record.run_id,
          player,
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
  // PBs are public, but each viewer must have a separate cache entry.
  player?: string;
}): Promise<MapPodium> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  const { data, response } = await api.GET("/v1/maps/{map}/leaderboard", {
    params: {
      path: { map: key.map },
      query: { style: key.style, track: 0, limit: 3, player: key.player },
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!data) throw new Error(`Map podium answered ${response.status}`);
  return {
    entries: data.entries.map(({ rank, player, time, run_id }) => ({
      rank,
      player,
      time,
      run_id,
    })),
    personalBest: key.player ? (data.player_entry ?? null) : undefined,
  };
}
