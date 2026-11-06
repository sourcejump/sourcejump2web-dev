// The Players page's search and results: players matching a name or SteamID, or recently active players. Staff
// who hold manage_bans also get a Banned tab, and staff who act on players can open a SteamID nobody has seen.
import { Search } from "lucide-react";
import Form from "next/form";
import type { CSSProperties } from "react";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { formatDate } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { BannedPlayers } from "@/features/staff/players/BannedPlayers";
import { Button, ButtonLink } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Flag } from "@/ui/Flag";
import { Input } from "@/ui/Input";
import { Link } from "@/ui/Link";
import { LinkTabs } from "@/ui/LinkTabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { managesPlayers } from "./PlayerHeader";
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
  const [result, me] = await Promise.all([
    api
      .GET("/v1/players", { params: { query: search ? { q: search } : {} } })
      .catch(() => undefined),
    signedInPlayer(),
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
        // Keyed by the search, so every row fades in on a new search, as on the Maps page.
        <Table key={search}>
          <TableHead>
            <tr>
              <TableHeaderCell>Player</TableHeaderCell>
              <TableHeaderCell numeric>Latest run</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {result.data.players.map((player, index) => (
              // The name link stretches over the whole row, so the row is one click target and still a
              // plain link (middle-click, keyboard) rather than a row with a click handler.
              <TableRow
                key={player.steamid64}
                className="motion-enter group relative"
                style={
                  {
                    "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                  } as CSSProperties
                }
              >
                <TableCell>
                  <Link
                    href={`/players/${player.steamid64}`}
                    className="group-hover:text-accent flex items-center gap-3 after:absolute after:inset-0"
                  >
                    <Avatar
                      name={player.name}
                      src={player.avatar_url ?? undefined}
                      size="sm"
                    />
                    {player.name}
                    <Flag code={player.country_code} />
                  </Link>
                </TableCell>
                <TableCell numeric className="text-text-muted">
                  {player.last_run_at ? (
                    <time dateTime={player.last_run_at}>
                      {formatDate(player.last_run_at)}
                    </time>
                  ) : (
                    "None yet"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
