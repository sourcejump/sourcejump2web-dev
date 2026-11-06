// Loads every range of one of the site's daily totals for its chart: players for the Players page, runs and
// world records for the Activity page. Nothing shows if they can't be loaded; the page works without it.
import { api } from "@/api/client";
import {
  DailyTotalsChart,
  type DailyTotalsData,
  type TotalsRange,
} from "./DailyTotalsChart";

const ranges = ["month", "year", "all"] as const satisfies TotalsRange[];

export async function DailyTotals({
  kind,
  heading,
  plain = false,
}: {
  kind: DailyTotalsData["kind"];
  /** Sits in the chart's top row, so the page doesn't spend a line on its own title. */
  heading?: string;
  /** Draws on the parent's surface instead of its own card. */
  plain?: boolean;
}) {
  const data: DailyTotalsData =
    kind === "players"
      ? {
          kind,
          ranges: Object.fromEntries(
            await Promise.all(
              ranges.map(async (range) => [
                range,
                (
                  await api
                    .GET("/v1/daily-totals/players", {
                      params: { query: { range } },
                    })
                    .catch(() => undefined)
                )?.data,
              ]),
            ),
          ),
        }
      : {
          kind,
          ranges: Object.fromEntries(
            await Promise.all(
              ranges.map(async (range) => [
                range,
                (
                  await api
                    .GET("/v1/daily-totals/runs", {
                      params: { query: { range } },
                    })
                    .catch(() => undefined)
                )?.data,
              ]),
            ),
          ),
        };
  // Players are a running total, which reads best over all time; runs are counted per day, best seen by
  // the month.
  return (
    <DailyTotalsChart
      data={data}
      initialRange={kind === "players" ? "all" : "month"}
      heading={heading}
      plain={plain}
    />
  );
}
