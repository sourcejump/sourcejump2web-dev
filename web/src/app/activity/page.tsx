// Activity page: one board. Runs and world records per day, then the latest runs, narrowed by style, track,
// lowest tier or world records only.
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
    <Page width="medium" className="gap-0">
      <div className="border-border bg-surface overflow-hidden rounded-lg border">
        <DailyTotals kind="runs" heading="Activity" plain />
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
      </div>
    </Page>
  );
}
