// Home page: the site's header with the way in, then what's happening now: how busy SourceJump is, the newest
// world records beside the top players, and the servers people are playing on.
import { HomeHeader } from "@/features/home/HomeHeader";
import { LiveNow } from "@/features/home/LiveNow";
import { Page } from "@/ui/Page";

export default function HomePage() {
  return (
    <Page className="gap-4">
      <HomeHeader />
      <LiveNow />
    </Page>
  );
}
