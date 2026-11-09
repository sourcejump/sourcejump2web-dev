// The Players page's board: the search beside the title, and under it recently active players, or for staff who
// hold manage_bans a Banned tab. Loads what the first view shows; PlayerFinder answers searches as they're typed.
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { BannedPlayers } from "@/features/staff/players/BannedPlayers";
import { LinkTabs } from "@/ui/LinkTabs";
import { managesPlayers } from "./PlayerHeader";
import { PlayerFinder } from "./PlayerFinder";
import { PlayerRows, SEARCH_LIMIT } from "./PlayerRows";

export async function PlayersBoard({
  q: search,
  banned,
  heading,
}: {
  /** The search in the address, trimmed; empty for recently active players. */
  q: string;
  /** The Banned tab, for staff who hold manage_bans. */
  banned: boolean;
  heading: ReactNode;
}) {
  const recentPlayers = () =>
    api
      .GET("/v1/players", { params: { query: { limit: SEARCH_LIMIT } } })
      .then((result) => result.data?.players)
      .catch(() => undefined);
  const [recent, found, me] = await Promise.all([
    recentPlayers(),
    search
      ? api
          .GET("/v1/players", {
            params: { query: { q: search, limit: SEARCH_LIMIT } },
          })
          .then((result) => result.data?.players)
          .catch(() => undefined)
      : undefined,
    signedInPlayer(),
  ]);
  const seesBans = me?.privileges.includes("manage_bans") ?? false;
  const showBans = banned && seesBans;
  const now = new Date();

  return (
    <PlayerFinder
      heading={heading}
      initialQuery={search}
      initialPlayers={found}
      initialNow={now.toISOString()}
      canManage={managesPlayers(me?.privileges)}
      defaultTitle={showBans ? "Banned" : "Recently active"}
      defaultAside={
        seesBans ? (
          <LinkTabs
            label="Players"
            tabs={[
              {
                href: "/players",
                label: "Recently active",
                current: !showBans,
              },
              {
                href: "/players?view=banned",
                label: "Banned",
                current: showBans,
              },
            ]}
          />
        ) : (
          <p className="text-text-subtle text-sm">Latest finished run</p>
        )
      }
    >
      {showBans ? (
        <div className="border-border border-t p-5">
          <BannedPlayers />
        </div>
      ) : !recent ? (
        <p className="border-border border-t px-5 py-6">
          Players couldn&apos;t be loaded. Try again in a moment.
        </p>
      ) : recent.length === 0 ? (
        <p className="border-border text-text-muted border-t px-5 py-6">
          Nobody has finished a run in the last 30 days.
        </p>
      ) : (
        <PlayerRows players={recent} now={now} />
      )}
    </PlayerFinder>
  );
}
