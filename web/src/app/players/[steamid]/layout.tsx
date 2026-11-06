// A player's pages: the header stays while the profile and the Manage view swap beneath it.
import { PlayerHeader } from "@/features/players/PlayerHeader";
import { Page } from "@/ui/Page";

export default function PlayerLayout({
  params,
  children,
}: LayoutProps<"/players/[steamid]">) {
  return (
    <Page className="gap-8">
      {params.then(({ steamid }) => (
        <PlayerHeader steamid={decodeURIComponent(steamid)} />
      ))}
      {children}
    </Page>
  );
}
