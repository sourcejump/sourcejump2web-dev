"use client";
// The Players page's list: each player with their latest run, any highlight it set, how much they played in the
// last 30 days and when they last finished a run. "Show more" loads the next page.
import { type CSSProperties, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { MapImage } from "@/features/maps/MapImage";
import { RunLink } from "@/features/runs/RunLink";
import { formatSince, formatTime, trackName } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { ListFooter } from "@/ui/ListFooter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { TierBadge } from "@/ui/TierBadge";
import { ActivityStrip } from "./ActivityStrip";

const numbers = new Intl.NumberFormat("en");

type Page = Schemas["PlayerList"];
type LatestRun = Schemas["LatestRun"];

export function PlayerList({
  first,
  q,
  styleNames,
}: {
  first: Page;
  /** The search `first` was loaded with, for loading the pages after it. */
  q: string;
  styleNames: Record<string, string>;
}) {
  const [players, setPlayers] = useState(first.players);
  const [cursor, setCursor] = useState(first.next_cursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const tierCount = first.tier_count;

  async function showMore(after: string) {
    setLoading(true);
    setFailed(false);
    const loaded = await api
      .GET("/v1/players", {
        params: { query: { ...(q ? { q } : {}), cursor: after } },
      })
      .then((result) => result.data)
      .catch(() => undefined);
    setLoading(false);
    if (!loaded) {
      setFailed(true);
      return;
    }
    // A player who played again since the first page moved up; they show once, where they were first seen.
    setPlayers((shown) => {
      const seen = new Set(shown.map((player) => player.steamid64));
      return [
        ...shown,
        ...loaded.players.filter((player) => !seen.has(player.steamid64)),
      ];
    });
    setCursor(loaded.next_cursor);
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Player</TableHeaderCell>
            <TableHeaderCell>Latest run</TableHeaderCell>
            <TableHeaderCell className="hidden lg:table-cell">
              <span className="sr-only">Highlight</span>
            </TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">
              Last 30 days
            </TableHeaderCell>
            <TableHeaderCell numeric className="hidden sm:table-cell">
              When
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {players.map((player, index) => {
            const run = player.latest_run;
            return (
              // The name link stretches over the whole row, so the row is one click target and still a plain
              // link (middle-click, keyboard). The run link sits above it and opens the run instead.
              <TableRow
                key={player.steamid64}
                className="motion-enter group relative"
                style={
                  {
                    // Rows past the twelfth share the last delay, so a page added by "Show more" fades in together.
                    "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                  } as CSSProperties
                }
              >
                <TableCell className="h-15">
                  <Link
                    href={`/players/${player.steamid64}`}
                    // Its own hover rather than the row's: the stretched link is hovered everywhere but over the run,
                    // so the name lights up only when a click opens the profile.
                    className="hover:text-accent flex items-center gap-3 after:absolute after:inset-0"
                  >
                    <Avatar
                      name={player.name}
                      src={player.avatar_url ?? undefined}
                      size="sm"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-3">
                        {/* Cut short on a phone, with the flag left out, so the row fits without scrolling sideways. */}
                        <span className="max-w-24 truncate sm:max-w-none">
                          {player.name}
                        </span>
                        <span className="hidden sm:contents">
                          <Flag code={player.country_code} />
                        </span>
                      </span>
                      {/* On a phone the When column is left out, so it shows here instead. */}
                      {run && (
                        <span className="text-text-muted text-xs sm:hidden">
                          <Since iso={run.finished_at} />
                        </span>
                      )}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  {run ? (
                    <RunLink
                      runId={run.run_id}
                      // Raised on hover, so it reads as its own target within the row: a click here opens the run.
                      className="group/run hover:bg-surface-overlay relative z-10 -mx-2 -my-1 flex items-center gap-3 rounded-md px-2 py-1 transition-colors duration-(--duration-fast)"
                    >
                      <span className="hidden sm:block">
                        <MapImage image={run.map_image} size="thumb" />
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          {run.tier != null && tierCount != null && (
                            <TierBadge tier={run.tier} tierCount={tierCount} />
                          )}
                          <span className="group-hover/run:text-accent max-w-36 truncate font-bold sm:max-w-none">
                            {run.map}
                          </span>
                        </span>
                        {/* One quiet line, place · time · style: the highlight column says what stood out. */}
                        <span className="text-text-muted text-sm">
                          {run.placement != null && `#${run.placement} · `}
                          {formatTime(run.time)}
                          {" · "}
                          {[
                            styleNames[run.style] ?? run.style,
                            run.track > 0 && trackName(run.track),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </RunLink>
                  ) : (
                    <span className="text-text-subtle">No 2.0 runs</span>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {run && <Highlight run={run} />}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <ActivityStrip days={player.activity} />
                </TableCell>
                <TableCell
                  numeric
                  className="text-text-muted hidden sm:table-cell"
                >
                  {run ? <Since iso={run.finished_at} /> : "–"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ListFooter
        summary={
          cursor
            ? `${numbers.format(players.length)} of ${numbers.format(Math.max(first.total, players.length))} players`
            : `All ${numbers.format(players.length)} players`
        }
        onShowMore={cursor ? () => void showMore(cursor) : undefined}
        loading={loading}
        failed={failed}
      />
    </div>
  );
}

/** How long ago the run finished. Counted from now, which differs between the server's render and the browser's. */
function Since({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatSince(iso)}
    </time>
  );
}

/**
 * What the run did, when it did something: a world record, a new personal best (by how much), or the player's
 * first finish on that board. A run that didn't beat their best shows nothing.
 */
function Highlight({ run }: { run: LatestRun }) {
  if (run.world_record) return <Badge tone="accent">WR</Badge>;
  if (run.placement == null) return null;
  if (run.previous_best == null) return <Badge>First finish</Badge>;
  return (
    <Badge tone="success">PB −{formatTime(run.previous_best - run.time)}</Badge>
  );
}
