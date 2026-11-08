// How a run stood against the world record when it finished, from the board's record history: what the Activity
// board shows beside each run (the API's `gap` there), worked out the same way for a run's own page.
import type { Schemas } from "@/api/client";

/** Seconds against the record (below zero for a new one), or "new" for a board's first record, which beat nothing. */
export type Gap = number | "new";

/**
 * The run against the world record standing when it finished, as the Activity board shows it: below zero for a
 * run that set a new record, "new" for the board's first record. Null when the history doesn't place it.
 */
export function gapWhenFinished(
  run: Pick<Schemas["RunDetail"], "id" | "time" | "finished_at">,
  history: Pick<Schemas["WrHistoryEntry"], "run_id" | "time" | "finished_at">[],
): Gap | null {
  const finished = Date.parse(run.finished_at);
  let standing: (typeof history)[number] | undefined;
  for (const record of history) {
    const at = Date.parse(record.finished_at);
    if (record.run_id === run.id || at > finished) continue;
    if (!standing || at >= Date.parse(standing.finished_at)) standing = record;
  }
  if (standing) return run.time - standing.time;
  return history.some((record) => record.run_id === run.id) ? "new" : null;
}
