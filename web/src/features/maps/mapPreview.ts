// A map page's link preview: its tier, the world record of the board the page opens on, and how many play it.
import type { Metadata } from "next";
import type { Schemas } from "@/api/client";
// Relative imports, as the unit tests resolve no `@/` paths.
import { formatTime } from "../runs/time";
import { count, linkPreview } from "../site/linkPreview";

/** The cover's full size, as the API stores it (`docs/site-api.md`). */
const COVER = { width: 1920, height: 1080 };

export function mapPreview(
  map: Schemas["MapDetail"],
  styleOrder: string[],
  styleName: (key: string) => string,
): Metadata {
  const cover = map.images[0];
  return linkPreview({
    title: map.name,
    description: mapDescription(map, styleOrder, styleName),
    picture: cover && { url: cover.url, ...COVER, wide: true },
  });
}

/** Plain facts, in the order a player looks for them: how hard, the time to beat, how busy. */
export function mapDescription(
  map: Schemas["MapDetail"],
  styleOrder: string[],
  styleName: (key: string) => string,
): string {
  const main = map.tracks.find((track) => track.track === 0);
  // The board the page opens on: the first ranked style with runs on the main track.
  const board = styleOrder
    .map((key) => main?.styles.find((style) => style.style === key))
    .find((style) => style !== undefined);
  const bonuses = map.tracks.filter((track) => track.track > 0).length;

  const parts: string[] = [];
  if (main?.tier != null && map.tier_count != null) {
    parts.push(`Tier ${main.tier}`);
  }
  if (board) {
    const record = board.world_record;
    parts.push(
      `World record ${formatTime(record.time)} by ${record.player.name} in ${styleName(board.style)}`,
    );
  } else if (map.legacy_players > 0) {
    parts.push("Pre-2.0 records only");
  }
  const players = count(map.players, "player", "players");
  parts.push(
    bonuses > 0 ? `${players}, ${count(bonuses, "bonus", "bonuses")}` : players,
  );
  return `${parts.join(". ")}.`;
}
