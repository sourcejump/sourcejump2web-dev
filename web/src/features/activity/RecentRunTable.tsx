"use client";
// The latest runs as a table: who, which board, the time, and where it placed when it finished. Runs come a
// hundred at a time and are paged here, so turning a page is instant; the next hundred load in the background.
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from "react";
import { api, type Schemas } from "@/api/client";
import { ReplayLink } from "@/features/replays/ReplayLink";
import { RunLink } from "@/features/runs/RunLink";
import {
  formatAge,
  formatGap,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { Pager } from "@/ui/Pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { TierBadge } from "@/ui/TierBadge";

type Run = Schemas["RecentRun"];
type Query = {
  style?: string;
  track?: "main" | "bonus";
  min_tier?: number;
  records?: boolean;
  /** Runs per request, a whole number of pages. */
  limit: number;
};

/**
 * Runs loaded so far, by chunk: chunk `k` starts `k * limit` runs from the newest. With `total`, the API takes
 * offsets and any chunk can load. Without it (an API before `total`), chunks load in order from `cursor`.
 */
export interface RunChunks {
  chunks: Record<number, Run[]>;
  total: number | null;
  cursor: string | null;
  tierCount: number | null;
}

export function RecentRunTable({
  first,
  query,
  address,
  pageSize,
  styleNames,
  showStyle,
}: {
  /** The chunk holding the page in the address, or every chunk up to it. */
  first: RunChunks;
  /** The filters `first` was loaded with, for loading the rest. */
  query: Query;
  /** The page's address with these filters, which the page number is added to. */
  address: string;
  pageSize: number;
  styleNames: Record<string, string>;
  /** With every style shown, each run names its own. */
  showStyle: boolean;
}) {
  const [loaded, setLoaded] = useState(first);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [turned, setTurned] = useState(false);
  // The latest chunks for the loops below, which outlive the render that started them.
  const latest = useRef(first);
  const inFlight = useRef(new Map<number, Promise<boolean>>());
  const turns = useRef(0);
  const board = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  // Held at the first page's height, so a short last page doesn't pull the page controls up.
  const [minHeight, setMinHeight] = useState<number>();
  const tierCount = first.tierCount;
  const chunk = query.limit;
  const pagesPerChunk = chunk / pageSize;
  const chunkOf = (p: number) => Math.floor((p - 1) / pagesPerChunk);

  // No `page` means page 1, never the page the table first opened on.
  const asked = Math.max(
    1,
    Math.floor(Number(useSearchParams().get("page") ?? 1)) || 1,
  );
  const more = loaded.total == null && loaded.cursor != null;
  const pageCount = pagesIn(loaded, pageSize);
  // Counted by the API, or once the last chunk has loaded without it.
  const total = loaded.total ?? (loaded.cursor == null ? runsIn(loaded) : null);
  const page = Math.min(asked, pageCount);
  const shown =
    loaded.chunks[chunkOf(page)]?.slice(
      ((page - 1) % pagesPerChunk) * pageSize,
      (((page - 1) % pagesPerChunk) + 1) * pageSize,
    ) ?? [];

  const pageHref = useCallback(
    (p: number) =>
      p > 1
        ? `${address}${address.includes("?") ? "&" : "?"}page=${p}`
        : address,
    [address],
  );

  /** Loads chunk `k`, once however many ask; false when it can't be loaded yet or failed. */
  const load = useCallback(
    (k: number): Promise<boolean> => {
      const pending = inFlight.current.get(k);
      if (pending) return pending;
      const { chunks, total, cursor } = latest.current;
      const byOffset = total != null;
      if (!byOffset && (k !== Object.keys(chunks).length || !cursor))
        return Promise.resolve(false);
      const request = api
        .GET("/v1/runs", {
          params: {
            query: byOffset
              ? { ...query, offset: k * query.limit }
              : { ...query, cursor: cursor ?? undefined },
          },
        })
        .then((result) => result.data)
        .catch(() => undefined)
        .then((next) => {
          inFlight.current.delete(k);
          setFailed(!next);
          if (!next) return false;
          latest.current = {
            ...latest.current,
            chunks: { ...latest.current.chunks, [k]: next.runs },
            // The count moves as runs come in, so the newest answer wins.
            total: byOffset ? next.total : null,
            cursor: byOffset ? null : (next.next_cursor ?? null),
          };
          setLoaded(latest.current);
          return true;
        });
      inFlight.current.set(k, request);
      return request;
    },
    [query],
  );

  /** Loads chunk `k`, walking the chunks before it first on an API without offsets. */
  const ensure = useCallback(
    async (k: number): Promise<boolean> => {
      while (!latest.current.chunks[k]) {
        const { chunks, total } = latest.current;
        if (!(await load(total != null ? k : Object.keys(chunks).length)))
          return false;
      }
      return true;
    },
    [load],
  );

  // Loads the page asked for if it isn't yet, as after going back to a far page, and the chunks either side of
  // it, so Next and Previous never wait.
  const askedChunk = chunkOf(asked);
  useEffect(() => {
    if (failed) return;
    void ensure(askedChunk).then((ok) => {
      if (!ok) return;
      const { total } = latest.current;
      if (total == null || (askedChunk + 1) * chunk < total)
        void ensure(askedChunk + 1);
      if (askedChunk > 0) void ensure(askedChunk - 1);
    });
  }, [askedChunk, failed, ensure, chunk]);

  // Past the last run, the address is corrected to the last page rather than showing one page and naming another.
  useEffect(() => {
    if (!more && asked > pageCount)
      window.history.replaceState(null, "", pageHref(pageCount));
  }, [more, asked, pageCount, pageHref]);

  async function go(target: number) {
    const turn = ++turns.current;
    const known = latest.current.total;
    const wanted =
      known != null
        ? Math.min(target, pagesIn(latest.current, pageSize))
        : target;
    if (!latest.current.chunks[chunkOf(wanted)]) {
      setWaiting(true);
      // A typed page past what's loaded walks forward to it, or to the last page if the runs end first.
      await ensure(chunkOf(wanted));
    }
    // A later click wins over one still loading.
    if (turn !== turns.current) return;
    setWaiting(false);
    setTurned(true);
    const next = pageHref(Math.min(wanted, pagesIn(latest.current, pageSize)));
    setMinHeight((held) => held ?? rows.current?.offsetHeight);
    if (next !== window.location.pathname + window.location.search)
      window.history.pushState(null, "", next);
    // Keep the table's top in view when a page is turned from the bottom of a long page.
    const top = board.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) board.current?.scrollIntoView({ block: "start" });
  }

  // The pager's links and box work without this; here they turn the page without asking the server.
  function onPagerClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a");
    if (
      !link ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    // Stopped here too, as Next's Link and Form navigate even when the event is already prevented.
    event.preventDefault();
    event.stopPropagation();
    void go(Number(new URL(link.href).searchParams.get("page") ?? 1));
  }

  function onPagerSubmit(event: FormEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.target as HTMLFormElement;
    const typed = Math.floor(Number(new FormData(form).get("page")));
    form.reset();
    if (typed >= 1) void go(typed);
  }

  if (loaded.total === 0 || (pageCount === 1 && !more && shown.length === 0)) {
    return (
      <p className="text-text-muted px-4 py-6">
        {query.records
          ? "No world records match these choices."
          : "No runs match these choices."}
      </p>
    );
  }

  return (
    <div ref={board} className="flex scroll-mt-20 flex-col">
      <div
        ref={rows}
        style={{ minHeight }}
        aria-busy={waiting}
        className={classNames(
          "transition-opacity duration-(--duration-fast)",
          waiting && "opacity-60",
        )}
      >
        <Table flush>
          <TableHead>
            <tr>
              <TableHeaderCell>Player</TableHeaderCell>
              <TableHeaderCell>Map</TableHeaderCell>
              <TableHeaderCell numeric className="pr-2">
                Time
              </TableHeaderCell>
              {/* Narrow padding keeps the play button close to the time and the place. */}
              <TableHeaderCell className="w-px pr-0 pl-0">
                <span className="sr-only">Replay</span>
              </TableHeaderCell>
              <TableHeaderCell numeric className="w-px pl-2">
                Place
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {shown.map((run, row) => (
              <TableRow
                key={run.run_id}
                // Only the first rows rise into place; a turned page swaps in at once.
                className={turned ? undefined : "motion-enter"}
                style={
                  {
                    "--motion-delay": `${Math.min(row, 12) * 20}ms`,
                  } as CSSProperties
                }
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/players/${run.player.steamid64}`}
                      className="hover:text-accent flex items-center gap-3"
                    >
                      <Avatar
                        name={run.player.name}
                        src={run.player.avatar_url ?? undefined}
                        size="sm"
                      />
                      {run.player.name}
                    </Link>
                    <Flag code={run.player.country_code} />
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {run.tier != null && tierCount != null && (
                      <TierBadge tier={run.tier} tierCount={tierCount} />
                    )}
                    <Link href={mapHref(run)} className="hover:text-accent">
                      {run.map}
                    </Link>
                    {(run.track > 0 || showStyle) && (
                      <span className="text-text-subtle">
                        {[
                          run.track > 0 && trackName(run.track),
                          showStyle && (styleNames[run.style] ?? run.style),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell numeric className="pr-2">
                  <span className="inline-flex flex-col items-end">
                    <span className="flex items-baseline gap-1.5">
                      <RunLink
                        runId={run.run_id}
                        className="hover:text-accent font-bold underline-offset-4 hover:underline"
                      >
                        {formatTime(run.time)}
                      </RunLink>
                      {/* Against the record when the run finished: what a new WR took off, or how far behind it was. */}
                      {run.gap != null && (
                        <span
                          className={classNames(
                            "text-xs",
                            run.gap < 0
                              ? "text-success"
                              : run.gap > 0
                                ? "text-danger"
                                : "text-text-subtle",
                          )}
                        >
                          {run.gap < 0
                            ? `(−${formatTime(-run.gap)})`
                            : `(${formatGap(run.gap)})`}
                        </span>
                      )}
                    </span>
                    {/* Counted from now, which differs between the server's render and the browser's. */}
                    <time
                      dateTime={run.finished_at}
                      suppressHydrationWarning
                      className="text-text-subtle text-xs leading-4"
                    >
                      {formatAge(run.finished_at)}
                    </time>
                  </span>
                </TableCell>
                <TableCell className="pr-0 pl-0">
                  <ReplayLink runId={run.run_id} />
                </TableCell>
                <TableCell numeric className="pl-2">
                  {run.world_record ? (
                    <Badge tone="accent">WR</Badge>
                  ) : run.placement != null ? (
                    <span className="inline-flex justify-end">
                      <Medal placement={run.placement} />
                    </span>
                  ) : (
                    <span className="text-text-subtle">–</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {(pageCount > 1 || more) && (
        <div
          onClickCapture={onPagerClick}
          onSubmitCapture={onPagerSubmit}
          className="border-border border-t py-2 pr-2 pl-4"
        >
          <Pager
            page={page}
            pageCount={pageCount}
            more={more}
            total={total ?? undefined}
            noun={
              (query.records ? "world record" : "run") +
              (total === 1 ? "" : "s")
            }
            href={pageHref}
          />
        </div>
      )}
      {failed && (
        <p role="alert" className="text-danger px-4 pb-3 text-sm">
          Older runs couldn&apos;t be loaded. Try again in a moment.
        </p>
      )}
    </div>
  );
}

/** The run's board on its map page. */
function mapHref(run: Schemas["RecentRun"]): string {
  const search = new URLSearchParams({ style: run.style });
  if (run.track > 0) search.set("track", String(run.track));
  return `/maps/${run.map}?${search}`;
}

function runsIn(loaded: RunChunks): number {
  return Object.values(loaded.chunks).reduce(
    (sum, runs) => sum + runs.length,
    0,
  );
}

function pagesIn(loaded: RunChunks, pageSize: number): number {
  return Math.max(1, Math.ceil((loaded.total ?? runsIn(loaded)) / pageSize));
}
