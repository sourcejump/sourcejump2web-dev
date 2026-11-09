// The Players page's search and results: players matching a name or SteamID, or recently active players. Staff
// who hold manage_bans also get a Banned tab, and staff who act on players can open a SteamID nobody has seen.
import { Search } from "lucide-react";
import Form from "next/form";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { BannedPlayers } from "@/features/staff/players/BannedPlayers";
import { Button, ButtonLink } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Input } from "@/ui/Input";
import { LinkTabs } from "@/ui/LinkTabs";
import { managesPlayers } from "./PlayerHeader";
import { PlayerList } from "./PlayerList";
import { STEAMID } from "./steamId";

export async function PlayerSearch({
  q,
  banned,
}: {
  q: string;
  /** The Banned tab, for staff who hold manage_bans. */
  banned: boolean;
}) {
  const search = q.trim();
  const [result, me, styles] = await Promise.all([
    api
      .GET("/v1/players", { params: { query: search ? { q: search } : {} } })
      .catch(() => undefined),
    signedInPlayer(),
    currentStyles(),
  ]);
  const seesBans = me?.privileges.includes("manage_bans") ?? false;
  const showBans = banned && seesBans && !search;

  return (
    <div className="flex flex-col gap-6">
      {/* The search and what the list below shows share one line, the tabs at its end. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Prefetching stays off here too, as for links (docs/design-system.md). */}
        <Form
          action="/players"
          prefetch={false}
          className="flex max-w-xl min-w-0 flex-1 basis-80 gap-2"
        >
          <Input
            icon={Search}
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Name, SteamID…"
            aria-label="Search players"
            className="flex-1"
          />
          <Button type="submit">Search</Button>
        </Form>

        {search ? (
          <h2 className="text-text-muted text-sm">
            Players matching “{search}”
          </h2>
        ) : seesBans ? (
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
          <h2 className="text-text-muted text-sm">Recently active</h2>
        )}
      </div>
      {showBans ? (
        <BannedPlayers />
      ) : !result ? (
        <p>Players couldn&apos;t be loaded. Try again in a moment.</p>
      ) : !result.data ? (
        <p className="text-text-muted">
          {result.error?.error ?? "That search didn't work."}
        </p>
      ) : result.data.players.length === 0 ? (
        <Card className="text-text-muted flex flex-col items-start gap-3">
          {search
            ? "No player has that name or SteamID."
            : "Nobody has finished a run in the last 30 days."}
          {STEAMID.test(search) && managesPlayers(me?.privileges) && (
            <ButtonLink
              href={`/players/${encodeURIComponent(search)}/manage`}
              size="sm"
            >
              Manage {search} anyway
            </ButtonLink>
          )}
        </Card>
      ) : (
        // Keyed by the search, so every row fades in on a new search and paging starts again, as on the Maps page.
        <PlayerList
          key={search}
          first={result.data}
          q={search}
          styleNames={Object.fromEntries(
            styles.keys.map((key) => [key, styles.name(key)]),
          )}
        />
      )}
    </div>
  );
}
