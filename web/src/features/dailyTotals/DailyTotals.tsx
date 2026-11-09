// Loads every range of one of the site's daily totals for its chart: players for the Players page, runs and
// world records for the Activity page. Nothing shows if they can't be loaded; the page works without it.
import { connection } from "next/server";
import { api } from "@/api/client";
import {
  DailyTotalsChart,
  type DailyTotalsData,
  type TotalsRange,
} from "./DailyTotalsChart";

const ranges = ["month", "year", "all"] as const satisfies TotalsRange[];

export async function DailyTotals({ kind }: { kind: DailyTotalsData["kind"] }) {
  // At request time, as `LiveNow`: the API isn't reachable while the site is built.
  await connection();
  // Both endpoints take the same range and return their own totals type, so one fetch serves either kind.
  const data: DailyTotalsData = {
    kind,
    ranges: Object.fromEntries(
      await Promise.all(
        ranges.map(async (range) => [
          range,
          (
            await api
              .GET(`/v1/daily-totals/${kind}`, {
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
    />
  );
}
