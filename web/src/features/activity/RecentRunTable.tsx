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

type Runs = Schemas["RecentRuns"];
type Query = {
  style?: string;
  track?: "main" | "bonus";
  min_tier?: number;
  records?: boolean;
  limit?: number;
};

export function RecentRunTable({
  first,
  query,
  address,
  page: firstPage,
  pageSize,
  styleNames,
  showStyle,
}: {
  /** The newest runs, enough to reach `page`. */
  first: Runs;
  /** The filters `first` was loaded with, for loading the runs after it. */
  query: Query;
  /** The page's address with these filters, which the page number is added to. */
  address: string;
  page: number;
  pageSize: number;
  styleNames: Record<string, string>;
  /** With every style shown, each run names its own. */
  showStyle: boolean;
}) {
  const [runs, setRuns] = useState(first.runs);
  const [cursor, setCursor] = useState(first.next_cursor ?? null);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  // The latest runs and cursor for the loops below, which outlive the render that started them.
  const latest = useRef({
    runs: first.runs,
    cursor: first.next_cursor ?? null,
  });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  // Held at the first page's height, so a short last page doesn't pull the page controls up.
  const [minHeight, setMinHeight] = useState<number>();
  const tierCount = first.tier_count;

  // The address holds the page, so a reload, a shared link and the back button all land on it.
  const asked = Number(useSearchParams().get("page") ?? firstPage);
  const pageCount = Math.max(1, Math.ceil(runs.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(asked) || 1), pageCount);
  const shown = runs.slice((page - 1) * pageSize, page * pageSize);

  const pageHref = useCallback(
    (p: number) =>
      p > 1
        ? `${address}${address.includes("?") ? "&" : "?"}page=${p}`
        : address,
    [address],
  );

  /** Loads the next hundred runs, once however many ask; false when there are none or they failed. */
  const loadMore = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const after = latest.current.cursor;
    if (!after) return Promise.resolve(false);
    inFlight.current = api
      .GET("/v1/runs", { params: { query: { ...query, cursor: after } } })
      .then((result) => result.data)
      .catch(() => undefined)
      .then((next) => {
        inFlight.current = null;
        setFailed(!next);
        if (!next) return false;
        latest.current = {
          runs: [...latest.current.runs, ...next.runs],
          cursor: next.next_cursor ?? null,
        };
        setRuns(latest.current.runs);
        setCursor(latest.current.cursor);
        return true;
      });
    return inFlight.current;
  }, [query]);

  // Keeps a few pages loaded past the one shown, so Next never waits.
  useEffect(() => {
    if (cursor && !failed && runs.length < (page + 4) * pageSize)
      void loadMore();
  }, [cursor, failed, runs.length, page, pageSize, loadMore]);

  async function go(target: number) {
    // A typed page past what's loaded walks forward to it, or to the last page if the runs end first.
    while (latest.current.runs.length < target * pageSize) {
      setWaiting(true);
      if (!(await loadMore())) break;
    }
    setWaiting(false);
    const count = Math.max(1, Math.ceil(latest.current.runs.length / pageSize));
    setMinHeight((held) => held ?? rows.current?.offsetHeight);
    window.history.pushState(null, "", pageHref(Math.min(target, count)));
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

  if (runs.length === 0) {
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
          {/* Keyed by page, so a turned page's rows fade in like the first. */}
          <TableBody key={page}>
            {shown.map((run, row) => (
              <TableRow
                key={run.run_id}
                className="motion-enter"
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
      {(pageCount > 1 || cursor) && (
        <div
          onClickCapture={onPagerClick}
          onSubmitCapture={onPagerSubmit}
          className="border-border border-t py-2 pr-2 pl-4"
        >
          <Pager
            page={page}
            pageCount={pageCount}
            more={cursor != null}
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
