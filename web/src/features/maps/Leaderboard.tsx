"use client";
// A map's leaderboard for one style, track and view: the 2.0 top comes with the page, other views load their
// first page when chosen, and "Show more" loads the rest a page at a time. Headings sort it: the API orders
// boards by time only, so sorting by anything else loads the whole board and sorts it here. The signed-in
// player's row stands out; on the 2.0 board, when it isn't among the rows shown, it's pinned below them. Legacy
// runs carry the Pre-2.0 badge.
import { useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { LegacyBadge } from "@/features/legacy/LegacyBadge";
import type { View } from "@/features/legacy/views";
import { ReplayLink } from "@/features/replays/ReplayLink";
import { RunLink } from "@/features/runs/RunLink";
import {
  formatAge,
  formatDate,
  formatGap,
  formatTime,
} from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { SortButton } from "@/ui/SortButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { avatarSrc } from "@/features/players/avatarSrc";

const PAGE_SIZE = 50;
/** The API's largest page, for loading a whole board to sort. */
const FULL_PAGE_SIZE = 100;
const sync = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

type Entry = Schemas["LeaderboardEntry"];
type SortKey = "time" | "player" | "jumps" | "strafes" | "sync" | "date";
interface Sort {
  key: SortKey;
  descending: boolean;
}

/** Which way a column sorts on its first click: best sync and newest date first, the rest from the smallest. */
const descendingFirst: Record<SortKey, boolean> = {
  time: false,
  player: false,
  jumps: false,
  strafes: false,
  sync: true,
  date: true,
};

/** Entries in the chosen order; ties keep the board's order by time. */
function sorted(entries: Entry[], sort: Sort): Entry[] {
  if (sort.key === "time" && !sort.descending) return entries;
  const value = (entry: Entry): number | string => {
    switch (sort.key) {
      case "time":
        return entry.time;
      case "player":
        return entry.player.name.toLowerCase();
      case "jumps":
        return entry.jumps;
      case "strafes":
        return entry.strafes;
      case "sync":
        return entry.sync;
      case "date":
        // Runs without a date sort as the oldest.
        return entry.finished_at ? Date.parse(entry.finished_at) : 0;
    }
  };
  const direction = sort.descending ? -1 : 1;
  return entries
    .map((entry, index) => ({ entry, index, value: value(entry) }))
    .sort((a, b) =>
      a.value < b.value
        ? -direction
        : a.value > b.value
          ? direction
          : a.index - b.index,
    )
    .map(({ entry }) => entry);
}

/** A page of a board, as the leaderboard endpoint or (for 2.0's top) the map's details give it. */
export type BoardPage = Pick<
  Schemas["Leaderboard"],
  "entries" | "next_cursor" | "total" | "world_record_time" | "fastest_time"
>;

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
  const [sort, setSort] = useState<Sort>({ key: "time", descending: false });
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

  function fetchPage(after: string | undefined, limit = PAGE_SIZE) {
    return api
      .GET("/v1/maps/{map}/leaderboard", {
        params: {
          path: { map },
          query: { style, track, view, limit, cursor: after },
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

  /**
   * Sorts by a column: again on the same one turns it around. Any order but time's needs the whole board.
   * shortcut: loads every row in the browser, 100 a request; fine for boards of a few hundred players, ask the API
   * for a `sort` parameter when boards grow to thousands.
   */
  async function sortBy(key: SortKey) {
    const next: Sort =
      sort.key === key
        ? { key, descending: !sort.descending }
        : { key, descending: descendingFirst[key] };
    if (key !== "time" && cursor) {
      setLoading(true);
      setFailed(false);
      let all = entries;
      let after: string | null | undefined = cursor;
      while (after) {
        const loaded = await fetchPage(after, FULL_PAGE_SIZE);
        if (!loaded) {
          setLoading(false);
          setFailed(true);
          return;
        }
        all = [...all, ...loaded.entries];
        after = loaded.next_cursor;
        setPage(loaded);
      }
      setEntries(all);
      setCursor(undefined);
      setLoading(false);
    }
    setSort(next);
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
  // Once "Show more" (or sorting, which loads the whole board) reaches them, their row is in the list and isn't
  // pinned twice.
  const pinned =
    mine &&
    !entries.some((entry) => entry.run_id === mine.run_id && !entry.legacy)
      ? mine
      : undefined;
  const heading = (key: SortKey, label: string) => (
    <SortButton
      label={label}
      // Fastest first is the expected order, so the arrow only shows once someone picks another.
      active={sort.key === key && (key !== "time" || sort.descending)}
      descending={sort.descending}
      onClick={() => void sortBy(key)}
    />
  );
  const ariaSort = (key: SortKey) =>
    sort.key === key
      ? sort.descending
        ? ("descending" as const)
        : ("ascending" as const)
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Table
        aria-busy={loading}
        className={classNames(
          "transition-opacity duration-(--duration-fast)",
          loading && "opacity-60",
        )}
      >
        <TableHead>
          <tr>
            {/* Short columns center under their names: a medal, a WR badge and a few digits are all narrower than
                the heading, and right-aligned they sat off to one side of it. Times and dates keep to the right.
                Place and Gap follow the time, so Time sorts for them. */}
            {/* "#" on a phone, as on Activity: the word would widen the column well past its medals. */}
            <TableHeaderCell centered className="w-px max-sm:px-2">
              <span className="max-sm:hidden">Place</span>
              <span aria-hidden className="sm:hidden">
                #
              </span>
              <span className="sr-only sm:hidden">Place</span>
            </TableHeaderCell>
            <TableHeaderCell aria-sort={ariaSort("player")}>
              {heading("player", "Player")}
            </TableHeaderCell>
            <TableHeaderCell
              numeric
              className="pr-2"
              aria-sort={ariaSort("time")}
            >
              {heading("time", "Time")}
            </TableHeaderCell>
            {/* Narrow padding keeps the play button close to the time, as on Activity. */}
            <TableHeaderCell className="w-px pr-0 pl-0">
              <span className="sr-only">Replay</span>
            </TableHeaderCell>
            {/* On a phone the gap and age go under the time instead, and these columns step aside. */}
            <TableHeaderCell centered className="max-sm:hidden">
              Gap
            </TableHeaderCell>
            <TableHeaderCell
              centered
              className="max-sm:hidden"
              aria-sort={ariaSort("jumps")}
            >
              {heading("jumps", "Jumps")}
            </TableHeaderCell>
            <TableHeaderCell
              centered
              className="max-sm:hidden"
              aria-sort={ariaSort("strafes")}
            >
              {heading("strafes", "Strafes")}
            </TableHeaderCell>
            <TableHeaderCell
              centered
              className="max-sm:hidden"
              aria-sort={ariaSort("sync")}
            >
              {heading("sync", "Sync")}
            </TableHeaderCell>
            <TableHeaderCell
              numeric
              className="max-sm:hidden"
              aria-sort={ariaSort("date")}
            >
              {heading("date", "Date")}
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {sorted(entries, sort).map((entry) => (
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
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-muted text-sm tabular-nums">
          {entries.length === page.total
            ? `All ${page.total} players`
            : `Top ${entries.length} of ${page.total} players`}
        </span>
        {failed && (
          <span className="text-danger text-sm">
            The rest of the board couldn&apos;t be loaded. Try again.
          </span>
        )}
        {cursor && (
          <Button
            size="sm"
            onClick={() => void showMore(cursor)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Show more"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** One player's row: place, player, time (with the gap and age under it on a phone), replay, gap, stats and date. */
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
      <TableCell className="text-center max-sm:px-2">
        {/* Medals mark 2.0 standings; the other views are lists by time. */}
        <span className="inline-flex justify-center align-middle">
          <Medal placement={entry.rank} plain={view !== "current"} />
        </span>
      </TableCell>
      {/* On a phone the player column takes only the room left (`max-w-0` with full width), and a long
          name ends in an ellipsis rather than pushing the times off the screen. */}
      <TableCell className="max-sm:w-full max-sm:max-w-0 max-sm:px-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/players/${entry.player.steamid64}`}
            className="hover:text-accent flex min-w-0 items-center gap-3 max-sm:gap-2"
          >
            {/* Left out on a phone, as on Activity's rows there: the name needs the room more. */}
            <Avatar
              name={entry.player.name}
              src={avatarSrc(entry.player)}
              size="sm"
              className="max-sm:hidden"
            />
            <span className="truncate">{entry.player.name}</span>
          </Link>
          {/* A missing country's placeholder costs a phone's narrow column more than it tells. */}
          <Flag
            code={entry.player.country_code}
            className={entry.player.country_code ? undefined : "max-sm:hidden"}
          />
          {entry.legacy && <LegacyBadge />}
        </span>
      </TableCell>
      <TableCell numeric className="pr-2">
        <span className="inline-flex flex-col items-end">
          <span className="flex items-baseline gap-1.5">
            <RunLink
              runId={entry.run_id}
              legacy={entry.legacy}
              className="hover:text-accent font-bold underline-offset-4 hover:underline"
            >
              {formatTime(entry.time)}
            </RunLink>
            {/* On a phone, the Gap column's record mark beside the time; a gap goes on the line below. */}
            {!entry.legacy && entry.time === record && (
              <span className="text-xs sm:hidden">
                <Badge tone="accent">WR</Badge>
              </span>
            )}
          </span>
          {/* Under the time on a phone: the gap and how long ago. Beside the time, the longest gap would
              widen the whole column and leave the names a few letters. */}
          <span className="flex items-baseline gap-1.5 text-xs leading-4 sm:hidden">
            {!(!entry.legacy && entry.time === record) &&
              entry.time !== fastest &&
              fastest != null && (
                <span className="text-danger">
                  ({formatGap(entry.time - fastest)})
                </span>
              )}
            {entry.finished_at && (
              // Counted from now, which differs between the server's render and the browser's.
              <time
                dateTime={entry.finished_at}
                suppressHydrationWarning
                className="text-text-subtle"
              >
                {formatAge(entry.finished_at)}
              </time>
            )}
          </span>
        </span>
      </TableCell>
      <TableCell className="pr-0 pl-0">
        {/* Replays open by 2.0 run ID; a pre-2.0 run's ID is the old site's. */}
        {!entry.legacy && <ReplayLink runId={entry.run_id} />}
      </TableCell>
      <TableCell className="text-text-muted text-center tabular-nums max-sm:hidden">
        {!entry.legacy && entry.time === record ? (
          <Badge tone="accent">WR</Badge>
        ) : entry.time === fastest || fastest == null ? null : (
          <span className="text-danger">{formatGap(entry.time - fastest)}</span>
        )}
      </TableCell>
      <TableCell className="text-text-muted text-center tabular-nums max-sm:hidden">
        {entry.jumps}
      </TableCell>
      <TableCell className="text-text-muted text-center tabular-nums max-sm:hidden">
        {entry.strafes}
      </TableCell>
      <TableCell className="text-text-muted text-center tabular-nums max-sm:hidden">
        {sync.format(entry.sync)}%
      </TableCell>
      <TableCell numeric className="text-text-muted max-sm:hidden">
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
