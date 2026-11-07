// The orders a profile's personal bests can be sorted in, and each one's gap to its board's record. Apart from the
// table (PlayerStyles), so the ordering is tested without the page.
import type { Schemas } from "@/api/client";

type PersonalBest = Schemas["PersonalBest"];
export type PbSortKey = "place" | "map" | "style" | "time" | "gap" | "date";
export interface PbSort {
  key: PbSortKey;
  descending: boolean;
}

export function sameSort(a: PbSort, b: PbSort): boolean {
  return a.key === b.key && a.descending === b.descending;
}

/** Behind the board's record; null for a legacy run. */
export function gapOf(pb: PersonalBest): number | null {
  return pb.world_record_time == null ? null : pb.time - pb.world_record_time;
}

/** Personal bests in the chosen order; rows without the value (a legacy run's place or gap) go last either way. */
export function sortedPbs(
  personalBests: PersonalBest[],
  sort: PbSort,
  styleName: (key: string) => string,
): PersonalBest[] {
  const value = (pb: PersonalBest): number | string | null => {
    switch (sort.key) {
      case "place":
        return pb.rank ?? null;
      case "map":
        return pb.map.toLowerCase();
      case "style":
        return styleName(pb.style).toLowerCase();
      case "time":
        return pb.time;
      case "gap":
        return gapOf(pb);
      case "date":
        return pb.finished_at ? Date.parse(pb.finished_at) : null;
    }
  };
  const direction = sort.descending ? -1 : 1;
  return personalBests
    .map((pb, index) => ({ pb, index, value: value(pb) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        return a.value === b.value
          ? a.index - b.index
          : a.value === null
            ? 1
            : -1;
      }
      return a.value < b.value
        ? -direction
        : a.value > b.value
          ? direction
          : a.index - b.index;
    })
    .map(({ pb }) => pb);
}
