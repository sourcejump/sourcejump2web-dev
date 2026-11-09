// A player's profile, under their header: their details, then their personal bests by style and tier, their
// year of runs, and per style their personal bests.
import { notFound, redirect } from "next/navigation";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { Card } from "@/ui/Card";
import { getPlayer } from "./playerDetail";
import { PlayerDetails } from "./PlayerDetails";
import { PlayerStyles } from "./PlayerStyles";

export async function PlayerProfile({ steamid }: { steamid: string }) {
  const [result, styles, me] = await Promise.all([
    getPlayer(steamid),
    currentStyles(),
    signedInPlayer(),
  ]);

  if (!result) {
    return <p>This profile couldn&apos;t be loaded. Try again in a moment.</p>;
  }
  if (!result.data) {
    if (result.response.status === 404 || result.response.status === 422) {
      notFound();
    }
    return <p>This profile couldn&apos;t be loaded. Try again in a moment.</p>;
  }
  const player = result.data;
  // SteamID2 and SteamID3 links land on the one SteamID64 address.
  if (player.steamid64 !== steamid) {
    redirect(`/players/${player.steamid64}`);
  }

  return (
    <>
      <PlayerDetails player={player} me={me} />
      {player.styles.length === 0 && player.legacy_maps === 0 ? (
        <Card className="text-text-muted">
          No personal bests yet. They show here once a run is finished on a
          SourceJump server.
        </Card>
      ) : (
        <PlayerStyles
          player={player}
          // The API counts activity by UTC day; the calendar dates its squares from the same day.
          today={new Date().toISOString().slice(0, 10)}
          styleOrder={styles.keys}
          styleNames={Object.fromEntries(
            styles.keys.map((k) => [k, styles.name(k)]),
          )}
        />
      )}
    </>
  );
}
