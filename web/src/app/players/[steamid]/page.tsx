// A player's profile page, under their header. Any SteamID form works in the URL and lands on the SteamID64
// address.
import type { Metadata } from "next";
import { PlayerProfile } from "@/features/players/PlayerProfile";
import { PageView } from "@/ui/Page";

export const metadata: Metadata = { title: "Player" };

export default function PlayerPage({
  params,
}: PageProps<"/players/[steamid]">) {
  return (
    <PageView className="gap-8">
      {params.then(({ steamid }) => (
        <PlayerProfile steamid={decodeURIComponent(steamid)} />
      ))}
    </PageView>
  );
}
