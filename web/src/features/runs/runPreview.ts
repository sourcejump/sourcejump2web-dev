// A run page's link preview: who ran which map, the time, and its place while it's a personal best, over the map's
// card. Runs share their map's card, so there are only as many cards as maps.
import type { Metadata } from "next";
import type { Schemas } from "@/api/client";
// A relative import, as the unit tests resolve no `@/` paths.
import { card, linkPreview } from "../site/linkPreview";
import { formatTime, trackName } from "./time";

export function runPreview(
  run: Schemas["RunDetail"],
  styleName: (key: string) => string,
): Metadata {
  return linkPreview({
    title: `${run.player.name} on ${run.map}`,
    description: runDescription(run, styleName),
    picture: run.map_card_url ? card(run.map_card_url) : undefined,
  });
}

export function runDescription(
  run: Schemas["RunDetail"],
  styleName: (key: string) => string,
): string {
  const where =
    run.track === 0 ? "the main track" : trackName(run.track).toLowerCase();
  const time = `${formatTime(run.time)} in ${styleName(run.style)} on ${where}.`;
  // An invalidated run's page says so without the reason (`docs/domain.md`).
  if (run.invalidated) return `${time} Invalidated.`;
  // Only while it's a personal best; "Place 1" rather than "World record", since tied places share it.
  return run.rank == null ? time : `${time} Place ${run.rank}.`;
}
