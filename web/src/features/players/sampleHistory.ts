import type { Schemas } from "@/api/client";

export interface ProfileHistoryPoint {
  date: string;
  rank: number;
  points: number;
}

/** Development fixtures only: never manufacture history for real players or production. */
export function sampleHistory(
  player: Pick<Schemas["PlayerProfile"], "steamid64" | "styles">,
  now = new Date(),
) {
  const local = new URL(process.env.SJ_API_URL ?? "http://127.0.0.1:8080");
  const id = BigInt(player.steamid64);
  if (
    process.env.NODE_ENV !== "development" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) ||
    id < 76561199900000001n ||
    id > 76561199900000060n
  )
    return undefined;
  const progress = [0, 0, 0.25, 0.3, 0.44, 0.53, 0.6, 0.64, 0.86, 0.9, 0.88, 1];
  const result: Record<string, ProfileHistoryPoint[]> = {};
  for (const style of player.styles) {
    for (const [track, standing] of [
      ["main", style.main_standing],
      ["bonuses", style.bonus_standing],
    ] as const) {
      if (!standing) continue;
      result[`${style.style}:${track}`] = progress.map((value, month) => ({
        date: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + month, 1),
        ).toISOString(),
        rank: Math.round(
          standing.rank + (1 - value) * Math.max(20, standing.rank * 2),
        ),
        points: Math.round(standing.points * (0.35 + value * 0.65)),
      }));
    }
  }
  return result;
}
