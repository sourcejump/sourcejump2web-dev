// Players page, laid out as the other boards: the title with how many players have a recorded time and the search
// beside it, players found as you type or recently active in two columns, then players over time. For staff, a
// Banned tab.
import type { Metadata } from "next";
import { api } from "@/api/client";
import { DailyTotals } from "@/features/dailyTotals/DailyTotals";
import { PlayersBoard } from "@/features/players/PlayerSearch";
import { CountUp } from "@/ui/CountUp";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Players",
  description: "Find a player by name or SteamID.",
};

export default function PlayersPage({ searchParams }: PageProps<"/players">) {
  return (
    <Page className="gap-4">
      {searchParams.then(async ({ q, view }) => {
        const search = typeof q === "string" ? q.trim() : "";
        const total = await playerTotal();
        return (
          <>
            <PlayersBoard
              q={search}
              banned={view === "banned"}
              heading={
                <div className="flex flex-col gap-1">
                  <h1 className="text-3xl font-bold">Players</h1>
                  {total != null && (
                    <p className="text-text-muted">
                      <span className="text-text font-bold">
                        <CountUp value={total} />
                      </span>{" "}
                      players have a recorded time on SourceJump.
                    </p>
                  )}
                </div>
              }
            />
            <DailyTotals kind="players" />
          </>
        );
      })}
    </Page>
  );
}

/** How many players have a recorded time; none if the totals can't be loaded. */
async function playerTotal(): Promise<number | undefined> {
  const result = await api
    .GET("/v1/daily-totals/players", { params: { query: { range: "month" } } })
    .catch(() => undefined);
  return result?.data?.points.at(-1)?.players;
}
