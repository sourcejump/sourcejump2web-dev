"use client";
// The latest runs as a table: who, which board, the time, and where it placed when it finished. "Show more"
// loads older runs a page at a time.
import { useState, type CSSProperties } from "react";
import { api, type Schemas } from "@/api/client";
import { RunLink } from "@/features/runs/RunLink";
import {
  formatGap,
  formatSince,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Card } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
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
import { TierBadge } from "@/ui/TierBadge";

type Page = Schemas["RecentRuns"];
type Query = {
  style?: string;
  track?: "main" | "bonus";
  min_tier?: number;
  records?: boolean;
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
  const [runs, setRuns] = useState(first.runs);
  const [cursor, setCursor] = useState(first.next_cursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const tierCount = first.tier_count;

  async function showMore(after: string) {
    setLoading(true);
    setFailed(false);
    const loaded = await api
      .GET("/v1/runs", { params: { query: { ...query, cursor: after } } })
      .then((result) => result.data)
      .catch(() => undefined);
    setLoading(false);
    if (!loaded) {
      setFailed(true);
      return;
    }
    setRuns((shown) => [...shown, ...loaded.runs]);
    setCursor(loaded.next_cursor);
  }

  if (runs.length === 0) {
    return (
      <Card className="text-text-muted">
        {query.records
          ? "No world records match these choices."
          : "No runs match these choices."}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className="hidden w-28 sm:table-cell">
              When
            </TableHeaderCell>
            <TableHeaderCell>Player</TableHeaderCell>
            <TableHeaderCell>Map</TableHeaderCell>
            <TableHeaderCell numeric>Time</TableHeaderCell>
            <TableHeaderCell numeric className="hidden w-20 sm:table-cell">
              Place
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {runs.map((run, index) => (
            <TableRow
              key={run.run_id}
              className="motion-enter"
              style={
                {
                  // Rows past the twelfth share the last delay, so a page added by "Show more" fades in together.
                  "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                } as CSSProperties
              }
            >
              <TableCell className="text-text-muted hidden sm:table-cell">
                <Since iso={run.finished_at} />
              </TableCell>
              {/* On a phone the row fits without scrolling sideways: When moves under the name, the style under
                  the map and the place under the time, names are cut short, and the flag, tier and gap are left out. */}
              <TableCell className="h-14 sm:h-12">
                <span className="flex items-center gap-2">
                  <Link
                    href={`/players/${run.player.steamid64}`}
                    className="hover:text-accent flex items-center gap-2 sm:gap-3"
                  >
                    <Avatar
                      name={run.player.name}
                      src={run.player.avatar_url ?? undefined}
                      size="sm"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="max-w-20 truncate sm:max-w-none">
                        {run.player.name}
                      </span>
                      <span className="text-text-muted text-xs sm:hidden">
                        <Since iso={run.finished_at} />
                      </span>
                    </span>
                  </Link>
                  <span className="hidden sm:contents">
                    <Flag code={run.player.country_code} />
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  {run.tier != null && tierCount != null && (
                    <span className="hidden sm:contents">
                      <TierBadge tier={run.tier} tierCount={tierCount} />
                    </span>
                  )}
                  <Link
                    href={mapHref(run)}
                    className="hover:text-accent max-w-28 truncate sm:max-w-none"
                  >
                    {run.map}
                  </Link>
                  {(run.track > 0 || showStyle) && (
                    <span className="text-text-subtle max-w-28 truncate text-xs sm:max-w-none sm:text-sm">
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
              <TableCell numeric>
                {/* Against the record when the run finished: what a new WR took off, or how far behind it was. */}
                {run.gap != null && (
                  <span
                    className={classNames(
                      "mr-2 hidden text-xs sm:inline",
                      run.gap < 0 ? "text-success" : "text-text-subtle",
                    )}
                  >
                    {run.gap < 0
                      ? `−${formatTime(-run.gap)}`
                      : formatGap(run.gap)}
                  </span>
                )}
                <RunLink
                  runId={run.run_id}
                  className="hover:text-accent font-bold underline-offset-4 hover:underline"
                >
                  {formatTime(run.time)}
                </RunLink>
                {(run.world_record || run.placement != null) && (
                  <span
                    className={classNames(
                      "block text-xs sm:hidden",
                      run.world_record ? "text-accent" : "text-text-muted",
                    )}
                  >
                    {run.world_record ? "WR" : `#${run.placement}`}
                  </span>
                )}
              </TableCell>
              <TableCell numeric className="hidden sm:table-cell">
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
      <ListFooter
        summary={summary(runs.length, first.total, !cursor, query.records)}
        onShowMore={cursor ? () => void showMore(cursor) : undefined}
        loading={loading}
        failed={failed}
      />
    </div>
  );
}

const numbers = new Intl.NumberFormat("en");

/**
 * "Latest 50 of 3,039 runs". The total is the first page's; once everything is shown, the rows themselves are
 * counted, as runs finished since would make the two disagree.
 */
function summary(
  shown: number,
  total: number | null | undefined,
  complete: boolean,
  records: boolean | undefined,
): string | undefined {
  const what = records ? "world records" : "runs";
  if (complete) return `All ${numbers.format(shown)} ${what}`;
  if (total == null) return undefined;
  return `Latest ${numbers.format(shown)} of ${numbers.format(Math.max(total, shown))} ${what}`;
}

/** The run's board on its map page. */
function mapHref(run: Schemas["RecentRun"]): string {
  const search = new URLSearchParams({ style: run.style });
  if (run.track > 0) search.set("track", String(run.track));
  return `/maps/${run.map}?${search}`;
}

/** How long ago the run finished. Counted from now, which differs between the server's render and the browser's. */
function Since({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatSince(iso)}
    </time>
  );
}
