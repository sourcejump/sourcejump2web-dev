// Leaderboards page: the top players by points and by completions, per style and track, and pre-2.0.
import type { Metadata } from "next";
import { Leaderboards } from "@/features/leaderboards/Leaderboards";
import { SectionTitle } from "@/features/site/SectionTitle";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "Players ranked by points and completed maps, per style.",
};

export default function LeaderboardsPage({
  searchParams,
}: PageProps<"/leaderboards">) {
  return (
    <Page className="gap-6">
      <SectionTitle>Leaderboards</SectionTitle>
      {searchParams.then(({ style, track, view }) => (
        <Leaderboards
          params={{
            style: typeof style === "string" ? style : undefined,
            track: typeof track === "string" ? track : undefined,
            view: typeof view === "string" ? view : undefined,
          }}
        />
      ))}
    </Page>
  );
}
