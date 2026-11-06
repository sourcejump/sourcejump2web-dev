"use client";
// The latest runs as a table: who, which board, the time, and where it placed when it finished. Previous and
// Next step through older runs a page at a time.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
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
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { TierBadge } from "@/ui/TierBadge";

type Page = Schemas["RecentRuns"];
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
  styleNames,
  showStyle,
}: {
  first: Page;
  /** The filters `first` was loaded with, for loading the pages after it. */
  query: Query;
  styleNames: Record<string, string>;
  /** With every style shown, each run names its own. */
  showStyle: boolean;
}) {
  // Pages already seen stay loaded, so going back is instant.
  const [pages, setPages] = useState([first]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  // Held at the first page's height, so a short last page doesn't pull the page controls up.
  const [minHeight, setMinHeight] = useState<number>();
  const tierCount = first.tier_count;
  const page = pages[index] ?? first;
  const runs = page.runs;

  function show(next: number) {
    setMinHeight((held) => held ?? rows.current?.offsetHeight);
    setIndex(next);
    // Keep the table's top in view when a page is turned from the bottom of a long page.
    const top = board.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) board.current?.scrollIntoView({ block: "start" });
  }

  async function showNext() {
    if (pages[index + 1]) return show(index + 1);
    if (!page.next_cursor) return;
    setLoading(true);
    setFailed(false);
    const loaded = await api
      .GET("/v1/runs", {
        params: { query: { ...query, cursor: page.next_cursor } },
      })
      .then((result) => result.data)
      .catch(() => undefined);
    setLoading(false);
    if (!loaded) {
      setFailed(true);
      return;
    }
    setPages((seen) => [...seen.slice(0, index + 1), loaded]);
    show(index + 1);
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
      <div ref={rows} style={{ minHeight }}>
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
          <TableBody key={index}>
            {runs.map((run, row) => (
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
      {(index > 0 || page.next_cursor) && (
        <nav
          aria-label="Pages"
          className="border-border flex items-center gap-3 border-t py-2 pr-1.5 pl-4"
        >
          <span className="text-text-subtle text-sm tabular-nums">
            Page {index + 1}
          </span>
          {failed && (
            <span role="alert" className="text-danger text-sm">
              Couldn&apos;t load the next page. Try again.
            </span>
          )}
          <span className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => show(index - 1)}
              disabled={index === 0}
              className="pl-2"
            >
              <ChevronLeft aria-hidden />
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void showNext()}
              disabled={loading || !page.next_cursor}
              className="pr-2"
            >
              Next
              <ChevronRight aria-hidden />
            </Button>
          </span>
        </nav>
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
