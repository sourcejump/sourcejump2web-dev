// A player page's link preview: their name, avatar, and what they've finished across every style.
import type { Metadata } from "next";
import type { Schemas } from "@/api/client";
// A relative import, as the unit tests resolve no `@/` paths.
import { count, linkPreview } from "../site/linkPreview";

export function playerPreview(player: Schemas["PlayerProfile"]): Metadata {
  return linkPreview({
    title: player.name,
    description: playerDescription(player),
    picture: player.avatar_url
      ? { url: player.avatar_url, wide: false }
      : undefined,
  });
}

export function playerDescription(player: Schemas["PlayerProfile"]): string {
  const all = player.all_styles;
  if (player.first_run_at == null) {
    return player.legacy_maps > 0
      ? `Pre-2.0 records on ${count(player.legacy_maps, "map", "maps")}.`
      : "No runs yet.";
  }
  const maps = `Finished ${all.completed_maps} of ${count(player.map_count, "map", "maps")}`;
  const records =
    all.world_records > 0
      ? `, with ${count(all.world_records, "world record", "world records")}`
      : "";
  return `${maps}${records}, across all styles.`;
}
