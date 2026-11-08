// A player's profile page, under their header. Any SteamID form works in the URL and lands on the SteamID64
// address.
import type { Metadata } from "next";
import { getPlayer } from "@/features/players/playerDetail";
import { playerPreview } from "@/features/players/playerPreview";
import { PlayerProfile } from "@/features/players/PlayerProfile";
import { PageView } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/players/[steamid]">): Promise<Metadata> {
  // The same read as the header's (`getPlayer` is per request), so the preview costs no extra request.
  const steamid = decodeURIComponent((await params).steamid);
  const player = (await getPlayer(steamid))?.data;
  return player ? playerPreview(player) : { title: "Player" };
}

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
