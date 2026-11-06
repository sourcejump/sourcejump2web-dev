// Home page: the site's header, what bunnyhopping is, how to start, and the latest records and servers.
import { BhopIntro } from "@/features/home/BhopIntro";
import { GetStarted } from "@/features/home/GetStarted";
import { HomeHeader } from "@/features/home/HomeHeader";
import { LiveNow } from "@/features/home/LiveNow";
import { Page } from "@/ui/Page";

export default function HomePage() {
  return (
    <Page className="gap-20">
      <HomeHeader />
      <BhopIntro />
      <GetStarted />
      <LiveNow />
    </Page>
  );
}
