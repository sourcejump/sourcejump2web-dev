// One leaderboard in full: /leaderboards/points or /leaderboards/completed, with the overview's choices.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  LeaderboardList,
  listTitle,
  type Ranking,
} from "@/features/leaderboards/LeaderboardList";
import { Page } from "@/ui/Page";

const rankings: readonly string[] = ["points", "completed"] satisfies Ranking[];

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/leaderboards/[ranking]">): Promise<Metadata> {
  const [{ ranking }, { track }] = await Promise.all([params, searchParams]);
  if (!rankings.includes(ranking)) return {};
  return {
    title: listTitle(
      ranking as Ranking,
      typeof track === "string" ? track : undefined,
    ),
  };
}

export default function LeaderboardListPage({
  params,
  searchParams,
}: PageProps<"/leaderboards/[ranking]">) {
  return (
    <Page className="gap-6">
      {Promise.all([params, searchParams]).then(
        ([{ ranking }, { style, track, view }]) => {
          if (!rankings.includes(ranking)) notFound();
          return (
            <LeaderboardList
              ranking={ranking as Ranking}
              params={{
                style: typeof style === "string" ? style : undefined,
                track: typeof track === "string" ? track : undefined,
                view: typeof view === "string" ? view : undefined,
              }}
            />
          );
        },
      )}
    </Page>
  );
}
