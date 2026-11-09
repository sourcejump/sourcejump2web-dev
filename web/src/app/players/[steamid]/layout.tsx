// A player's identity stays while the profile and Manage view swap beneath it.
import { PlayerHeader } from "@/features/players/PlayerHeader";
import { Page } from "@/ui/Page";
import { Link } from "@/ui/Link";
import { ArrowLeft } from "lucide-react";

export default function PlayerLayout({
  params,
  children,
}: LayoutProps<"/players/[steamid]">) {
  return (
    <Page width="fill" className="gap-6 px-4 pt-6 pb-10 sm:px-8">
      <Link
        href="/leaderboards"
        className="text-text-muted hover:text-accent inline-flex w-fit items-center gap-2 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Leaderboards
      </Link>
      {params.then(({ steamid }) => (
        <PlayerHeader steamid={decodeURIComponent(steamid)} />
      ))}
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </Page>
  );
}
