// A player's pages: the masthead stays while the profile and the Manage view swap beneath it.
import { PlayerHeader } from "@/features/players/PlayerHeader";
import { Page } from "@/ui/Page";

export default function PlayerLayout({
  params,
  children,
}: LayoutProps<"/players/[steamid]">) {
  return (
    // The masthead runs edge to edge, so the page sets its own width below it.
    <Page width="fill">
      {params.then(({ steamid }) => (
        <PlayerHeader steamid={decodeURIComponent(steamid)} />
      ))}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-6 pb-10 sm:px-8">
        {children}
      </div>
    </Page>
  );
}
