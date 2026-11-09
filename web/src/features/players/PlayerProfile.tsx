// A player's profile, under their header: their details, then per style their stats and personal bests.
import { notFound, redirect } from "next/navigation";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { Card } from "@/ui/Card";
import { getPlayer } from "./playerDetail";
import { PlayerDetails } from "./PlayerDetails";
import { PlayerStyles } from "./PlayerStyles";
import { sampleHistory } from "./sampleHistory";

export async function PlayerProfile({ steamid }: { steamid: string }) {
  const [result, styles, me, bonusBoard] = await Promise.all([
    getPlayer(steamid),
    currentStyles(),
    signedInPlayer(),
    api
      .GET("/v1/leaderboards/{ranking}", {
        params: {
          path: { ranking: "completed" },
          query: { track: "bonuses", limit: 1 },
        },
      })
      .catch(() => undefined),
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
      {player.styles.length === 0 && player.legacy_maps === 0 ? (
        <>
          <PlayerDetails player={player} me={me} />
          <Card className="text-text-muted">
            No personal bests yet. They show here once a run is finished on a
            SourceJump server.
          </Card>
        </>
      ) : (
        <PlayerStyles
          player={player}
          details={<PlayerDetails player={player} me={me} />}
          history={sampleHistory(player)}
          bonusTotal={bonusBoard?.data?.out_of}
          styleOrder={styles.keys}
          styleNames={Object.fromEntries(
            styles.keys.map((k) => [k, styles.name(k)]),
          )}
        />
      )}
    </>
  );
}
