// Activity page: runs and world records per day, then the latest runs, narrowed by style, track, lowest tier or
// world records only.
import type { Metadata } from "next";
import { RecentRuns } from "@/features/activity/RecentRuns";
import { DailyTotals } from "@/features/dailyTotals/DailyTotals";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Activity",
  description: "The latest runs and world records.",
};

export default function ActivityPage({ searchParams }: PageProps<"/activity">) {
  return (
    <Page className="gap-6">
      <h1 className="text-3xl font-bold">Activity</h1>
      <DailyTotals kind="runs" />
      {searchParams.then(({ style, track, tier, show }) => (
        <RecentRuns
          params={{
            style: typeof style === "string" ? style : undefined,
            track: typeof track === "string" ? track : undefined,
            tier: typeof tier === "string" ? tier : undefined,
            show: typeof show === "string" ? show : undefined,
          }}
        />
      ))}
    </Page>
  );
}
