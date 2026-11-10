"use client";
// A map's leaderboard for one style, track and view: the 2.0 top comes with the page, other views load their
// first page when chosen, and "Show more" loads the rest a page at a time. The signed-in player's row stands
// out; on the 2.0 board, when it isn't among the rows shown, it's pinned below them. Legacy runs carry the
// Pre-2.0 badge.
import { useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { LegacyBadge } from "@/features/legacy/LegacyBadge";
import type { View } from "@/features/legacy/views";
import { RunLink } from "@/features/runs/RunLink";
import { formatDate, formatGap, formatTime } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { ListFooter } from "@/ui/ListFooter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";

const PAGE_SIZE = 50;
const sync = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** A page of a board, as the leaderboard endpoint or (for 2.0's top) the map's details give it. */
export type BoardPage = Pick<
  Schemas["Leaderboard"],
  "entries" | "next_cursor" | "total" | "world_record_time" | "fastest_time"
>;

type Entry = Schemas["LeaderboardEntry"];

/** Give it a `key` per style, track and view, so switching boards starts again from the top. */
export function Leaderboard({
  map,
  style,
  track,
  view,
  first,
  me,
}: {
  map: string;
  style: string;
  track: number;
  view: View;
  /** The first page when it came with the map; left out, it's loaded here. */
  first?: BoardPage;
  /** The signed-in player's SteamID64, if any. */
  me: string | undefined;
}) {
  const [page, setPage] = useState<BoardPage | undefined>(first);
  const [entries, setEntries] = useState(first?.entries ?? []);
  const [cursor, setCursor] = useState(first?.next_cursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The signed-in player's own entry, wherever on the board it is. Only the 2.0 board ranks them.
  const [mine, setMine] = useState<Entry | undefined>();
  // A refreshed page (after a staff change, say) brings a new first page; start again from it.
  const [shownFrom, setShownFrom] = useState(first);
  if (first && shownFrom !== first) {
    setShownFrom(first);
    setPage(first);
    setEntries(first.entries);
    setCursor(first.next_cursor);
  }

  function fetchPage(after: string | undefined) {
    return api
      .GET("/v1/maps/{map}/leaderboard", {
        params: {
          path: { map },
          query: { style, track, view, limit: PAGE_SIZE, cursor: after },
        },
      })
      .then((result) => result.data)
      .catch(() => undefined);
  }

  function show(loaded: BoardPage | undefined, after: string | undefined) {
    if (!loaded) {
      setFailed(true);
      return;
    }
    setPage(loaded);
    setEntries((shown) =>
      after ? [...shown, ...loaded.entries] : loaded.entries,
    );
    setCursor(loaded.next_cursor);
  }

  async function showMore(after: string) {
    setLoading(true);
    setFailed(false);
    const loaded = await fetchPage(after);
    setLoading(false);
    show(loaded, after);
  }

  // Views other than 2.0's don't come with the map; their first page loads once the view is chosen.
  useEffect(() => {
    if (!first)
      void fetchPage(undefined).then((loaded) => show(loaded, undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key remounts this for another board
  }, []);

  // The top that comes with the map doesn't carry the player's own place; one row is asked for here, unless
  // they're already in that top.
  useEffect(() => {
    if (!me || view !== "current") return;
    if (first?.entries.some((entry) => entry.player.steamid64 === me)) return;
    void api
      .GET("/v1/maps/{map}/leaderboard", {
        params: {
          path: { map },
          query: { style, track, limit: 1, player: me },
        },
      })
      .then((result) => setMine(result.data?.player_entry ?? undefined))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key remounts this for another board
  }, []);

  if (!page) {
    return failed ? (
      <p className="text-danger text-sm">
        This board couldn&apos;t be loaded. Try again.
      </p>
    ) : null;
  }
  const fastest = page.fastest_time;
  const record = page.world_record_time;
  // Once "Show more" reaches them, their row is in the list and isn't pinned twice.
  const pinned =
    mine &&
    !entries.some((entry) => entry.run_id === mine.run_id && !entry.legacy)
      ? mine
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className="w-16">Place</TableHeaderCell>
            <TableHeaderCell>Player</TableHeaderCell>
            <TableHeaderCell numeric>Time</TableHeaderCell>
            {/* A phone shows place, player and time; the run's dialog, opened from the time, has the rest. */}
            <TableHeaderCell numeric>Gap</TableHeaderCell>
            <TableHeaderCell numeric className="hidden md:table-cell">
              Jumps
            </TableHeaderCell>
            <TableHeaderCell numeric className="hidden md:table-cell">
              Strafes
            </TableHeaderCell>
            <TableHeaderCell numeric className="hidden md:table-cell">
              Sync
            </TableHeaderCell>
            <TableHeaderCell numeric className="hidden sm:table-cell">
              Date
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {entries.map((entry) => (
            <EntryRow
              key={`${entry.legacy ? "pre" : "run"}-${entry.run_id}`}
              entry={entry}
              view={view}
              mine={entry.player.steamid64 === me}
              record={record}
              fastest={fastest}
            />
          ))}
        </TableBody>
        {pinned && (
          // Its own body, so the line above it reads as a gap in the list rather than the next place.
          <TableBody aria-label="Your place">
            <EntryRow
              entry={pinned}
              view={view}
              mine
              record={record}
              fastest={fastest}
              separated
            />
          </TableBody>
        )}
      </Table>
      <ListFooter
        summary={
          entries.length === page.total
            ? `All ${page.total} players`
            : `Top ${entries.length} of ${page.total} players`
        }
        onShowMore={cursor ? () => void showMore(cursor) : undefined}
        loading={loading}
        failed={failed}
      />
    </div>
  );
}

/** One player's row: place, player, time, gap to the fastest, stats and date. */
function EntryRow({
  entry,
  view,
  mine,
  record,
  fastest,
  separated = false,
}: {
  entry: Entry;
  view: View;
  /** The signed-in player's own row, which stands out. */
  mine: boolean;
  record: number | null | undefined;
  fastest: number | null | undefined;
  /** Set apart from the rows above it. */
  separated?: boolean;
}) {
  return (
    <TableRow highlight={mine} separated={separated}>
      <TableCell>
        {/* Medals mark 2.0 standings; the other views are lists by time. */}
        <Medal placement={entry.rank} plain={view !== "current"} />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <Link
            href={`/players/${entry.player.steamid64}`}
            className="hover:text-accent flex items-center gap-3"
          >
            <Avatar
              name={entry.player.name}
              src={entry.player.avatar_url ?? undefined}
              size="sm"
            />
            <span className="max-w-24 truncate sm:max-w-none">
              {entry.player.name}
            </span>
          </Link>
          <span className="hidden sm:contents">
            <Flag code={entry.player.country_code} />
          </span>
          {entry.legacy && <LegacyBadge />}
        </span>
      </TableCell>
      <TableCell numeric>
        <RunLink
          runId={entry.run_id}
          legacy={entry.legacy}
          className="hover:text-accent font-bold underline-offset-4 hover:underline"
        >
          {formatTime(entry.time)}
        </RunLink>
      </TableCell>
      <TableCell numeric className="text-text-muted">
        {!entry.legacy && entry.time === record ? (
          <Badge tone="accent">WR</Badge>
        ) : entry.time === fastest || fastest == null ? null : (
          formatGap(entry.time - fastest)
        )}
      </TableCell>
      <TableCell numeric className="text-text-muted hidden md:table-cell">
        {entry.jumps}
      </TableCell>
      <TableCell numeric className="text-text-muted hidden md:table-cell">
        {entry.strafes}
      </TableCell>
      <TableCell numeric className="text-text-muted hidden md:table-cell">
        {sync.format(entry.sync)}%
      </TableCell>
      <TableCell numeric className="text-text-muted hidden sm:table-cell">
        {entry.finished_at ? (
          <time dateTime={entry.finished_at}>
            {formatDate(entry.finished_at)}
          </time>
        ) : (
          "–"
        )}
      </TableCell>
    </TableRow>
  );
}
