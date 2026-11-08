// Loads a board's record history to place a run against the record standing when it finished (`gapWhenFinished`),
// for the run's page and the run dialog. Apart from the calculation, so that stays testable without the API client.
import { api, type Schemas } from "@/api/client";
import { type Gap, gapWhenFinished } from "./gapWhenFinished";

/** The run against the record when it finished, loading the board's record history; null when there's no gap to show or it can't be loaded. */
export async function loadGapWhenFinished(
  run: Pick<
    Schemas["RunDetail"],
    "id" | "time" | "finished_at" | "map" | "style" | "track"
  >,
): Promise<Gap | null> {
  const history = await api
    .GET("/v1/maps/{map}/wr-history", {
      params: {
        path: { map: run.map },
        query: { style: run.style, track: run.track },
      },
    })
    .then((result) => result.data?.records)
    .catch(() => undefined);
  return history ? gapWhenFinished(run, history) : null;
}
