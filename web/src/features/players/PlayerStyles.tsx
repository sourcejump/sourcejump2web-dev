"use client";
// A profile's style, track, view and show choice and what it shows: points rank, completed maps and world records in
// that style, then its personal bests or only its world records. Every style's 2.0 main-track first page
// arrives with the profile, so switching styles happens in place; bonuses, world records and the normal
// style's pre-2.0 views load when chosen. The counts are 2.0's in every view.
import { useSearchParams } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { LegacyBadge } from "@/features/legacy/LegacyBadge";
import {
  LEGACY_STYLE,
  type View,
  ViewMenu,
  viewFrom,
} from "@/features/legacy/views";
import { RunLink } from "@/features/runs/RunLink";
import { formatDate, formatTime } from "@/features/runs/time";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { Label } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import { CountUp } from "@/ui/CountUp";
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

const PAGE_SIZE = 50;
const numbers = new Intl.NumberFormat("en");
/** The Style and Track menus' choice of every style or every track. */
const ANY = "any";

type Tracks = "main" | "bonuses" | typeof ANY;

export function PlayerStyles({
  player,
  styleOrder,
  styleNames,
}: {
  player: Schemas["PlayerProfile"];
  /** Style keys in the ruleset's order. */
  styleOrder: string[];
  styleNames: Record<string, string>;
}) {
  const params = useSearchParams();
  const hasLegacy = player.legacy_maps > 0;
  const tracksParam = params.get("tracks");
  const tracks: Tracks =
    tracksParam === "bonuses" || tracksParam === ANY ? tracksParam : "main";
  // World records are 2.0 placements, so showing them alone sets aside the pre-2.0 views.
  const records = params.get("show") === "records";
  // The same choices on every profile, as on map pages: any style, every ranked style, then any the ruleset no
  // longer ranks that the player has times in. Styles without times are dimmed.
  const retired = player.styles
    .map((s) => s.style)
    .filter((key) => !styleOrder.includes(key));
  const styleKeys = [...styleOrder, ...retired];
  const summary = (key: string) => player.styles.find((s) => s.style === key);
  const hasTimes = (key: string) =>
    summary(key) !== undefined || (key === LEGACY_STYLE && hasLegacy);
  const styleKey =
    [ANY, ...styleKeys].find((key) => key === params.get("style")) ??
    styleKeys.find(hasTimes) ??
    styleKeys[0];
  if (!styleKey) return null;
  const anyStyle = styleKey === ANY;
  const current = anyStyle ? undefined : summary(styleKey);
  // The cards' numbers: one style's, or across every style.
  const counts = anyStyle ? player.all_styles : current;
  const withViews =
    hasLegacy && styleKey === LEGACY_STYLE && tracks === "main" && !records;
  // 2.0 first (lead, 2026-10-26); a player with no 2.0 runs in the style opens on their pre-2.0 runs.
  const view: View = withViews
    ? viewFrom(params.get("view"), current ? "current" : "legacy")
    : "current";
  const standing =
    tracks === "bonuses" ? current?.bonus_standing : current?.main_standing;
  const bonuses = counts?.completed_bonuses ?? 0;
  const maps = counts?.completed_maps ?? 0;
  const shownTotal =
    tracks === "main" ? maps : tracks === "bonuses" ? bonuses : maps + bonuses;
  const styleName = anyStyle ? "" : `${styleNames[styleKey] ?? styleKey} `;
  // The leaderboards and the map list are per style and kind of track; "any" opens their defaults.
  const boardStyle =
    anyStyle || styleKey === styleOrder[0] ? {} : { style: styleKey };

  // The choice lives in the address, so a view can be shared, but changing it doesn't load a page.
  function choose(choice: {
    style?: string;
    tracks?: Tracks;
    view?: View;
    records?: boolean;
  }) {
    const url = new URL(window.location.href);
    url.searchParams.set("style", choice.style ?? styleKey ?? LEGACY_STYLE);
    const nextTracks = choice.tracks ?? tracks;
    if (nextTracks === "main") url.searchParams.delete("tracks");
    else url.searchParams.set("tracks", nextTracks);
    if (choice.records ?? records) url.searchParams.set("show", "records");
    else url.searchParams.delete("show");
    if (choice.view) url.searchParams.set("view", choice.view);
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      <ChoiceBar>
        <ChoiceMenu
          label="Style"
          options={[
            { value: ANY, label: "Any" },
            ...styleKeys.map((key, index) => ({
              value: key,
              label: styleNames[key] ?? key,
              quiet: !hasTimes(key),
              startsGroup: index === 0,
            })),
          ]}
          value={styleKey}
          onChange={(style) => choose({ style })}
        />
        <ChoiceMenu
          label="Track"
          options={[
            { value: ANY, label: "Any" },
            { value: "main", label: "Main", startsGroup: true },
            { value: "bonuses", label: "Bonuses", quiet: bonuses === 0 },
          ]}
          value={tracks}
          onChange={(value) =>
            choose({
              tracks: value === "bonuses" || value === ANY ? value : "main",
            })
          }
        />
        <ChoiceMenu
          label="Show"
          options={[
            { value: "all", label: "All runs" },
            {
              value: "records",
              label: "World records",
              quiet: !counts?.world_records,
            },
          ]}
          value={records ? "records" : "all"}
          onChange={(value) => choose({ records: value === "records" })}
        />
        <ViewMenu
          value={view}
          available={withViews}
          onChange={(next) => choose({ view: next })}
        />
      </ChoiceBar>

      {/* One panel of the style's standing, split into what each number opens: rank, completed maps and world
          records. The rank is the style's points leaderboard place, on main tracks unless bonuses are shown;
          styles count apart, so any style has none. */}
      <div className="motion-enter border-border bg-surface grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3">
        <StatLink
          className="border-border col-span-2 border-b sm:col-span-1 sm:border-r sm:border-b-0"
          href={withQuery(
            "/leaderboards/points",
            view === "legacy"
              ? { view: "legacy" }
              : {
                  ...boardStyle,
                  ...(tracks === "bonuses" && { track: "bonuses" }),
                },
          )}
        >
          <Label>Rank</Label>
          <span
            className={classNames(
              "text-4xl font-bold",
              standing && medalText[standing.rank - 1],
            )}
          >
            {standing ? <CountUp value={standing.rank} /> : "—"}
          </span>
          <span className="text-text-muted mt-auto text-sm">
            {standing
              ? `${numbers.format(standing.points)} points${player.points_draft ? " · draft" : ""}`
              : anyStyle
                ? "Ranked per style"
                : "No points yet"}
          </span>
        </StatLink>
        <StatLink
          className="border-border border-r"
          href={withQuery("/maps", {
            player: player.steamid64,
            completed: "yes",
            ...boardStyle,
          })}
        >
          <Label>Completed maps</Label>
          <span className="flex items-baseline gap-1.5">
            <span className="text-4xl font-bold">
              <CountUp value={maps} />
            </span>
            <span className="text-text-muted text-lg">
              / {numbers.format(player.map_count)}
            </span>
          </span>
          {/* How far through the map list they are, with any bonuses beside; the numbers say it for screen
              readers. */}
          <span className="mt-auto flex items-center gap-3 text-sm">
            <span
              aria-hidden
              className="bg-surface-overlay block h-1 flex-1 overflow-hidden rounded-full"
            >
              <span
                className="bg-accent block h-full rounded-full"
                style={{
                  width: `${player.map_count ? Math.min(100, (maps / player.map_count) * 100) : 0}%`,
                }}
              />
            </span>
            {bonuses > 0 && (
              <span className="text-text-muted shrink-0">
                + {bonuses} {bonuses === 1 ? "bonus" : "bonuses"}
              </span>
            )}
          </span>
        </StatLink>
        {/* Every world record, newest first: any style, any track, 2.0 runs; pressed again, back to the opening view. A
            player without one has nothing to open. */}
        <StatLink
          pressed={records}
          onClick={
            counts?.world_records || records
              ? () =>
                  records
                    ? choose({
                        style: styleKeys.find(hasTimes) ?? styleKeys[0],
                        tracks: "main",
                        records: false,
                      })
                    : choose({ style: ANY, tracks: ANY, records: true })
              : undefined
          }
        >
          <Label>World records</Label>
          <span
            className={classNames(
              "text-4xl font-bold",
              counts?.world_records ? "text-accent" : undefined,
            )}
          >
            <CountUp value={counts?.world_records ?? 0} />
          </span>
          {counts?.world_records ? (
            <span className="text-text-muted mt-auto text-sm">
              {records ? "Showing every record" : "Show every record"}
            </span>
          ) : null}
        </StatLink>
      </div>

      {records && !counts?.world_records ? (
        <p className="text-text-muted">No {styleName}world records yet.</p>
      ) : view === "current" && !shownTotal ? (
        <p className="text-text-muted">
          No {styleName}personal bests
          {tracks === "main"
            ? " on main tracks"
            : tracks === "bonuses"
              ? " on bonuses"
              : ""}{" "}
          yet.
        </p>
      ) : (
        <PersonalBests
          key={`${styleKey}-${tracks}-${view}-${records}`}
          steamid64={player.steamid64}
          style={anyStyle ? undefined : styleKey}
          styleName={(key) => styleNames[key] ?? key}
          tracks={tracks === ANY ? undefined : tracks}
          view={view}
          records={records}
          first={
            view === "current" && tracks === "main" && current && !records
              ? {
                  personal_bests: current.personal_bests,
                  next_cursor: current.next_cursor,
                }
              : undefined
          }
          // The world record count covers main tracks and bonuses together, so it can't total one of them.
          total={view === "current" && !records ? shownTotal : undefined}
        />
      )}
    </>
  );
}

/** A path with a query string, leaving out unset values, and the "?" when there's nothing to ask. */
function withQuery(
  path: string,
  query: Record<string, string | false | undefined>,
): string {
  const text = new URLSearchParams(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();
  return text ? `${path}?${text}` : path;
}

/** Rank 1 to 3 in the medal colors, as on the boards. */
const medalText = ["text-gold", "text-silver", "text-bronze"];

/**
 * One cell of the standing panel: opens the page its number comes from, or changes the view. With neither,
 * it's a plain cell.
 */
function StatLink({
  href,
  onClick,
  pressed,
  className,
  children,
}: {
  href?: string;
  onClick?: () => void;
  /** For a cell that switches a view: whether that view is showing. */
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = classNames("flex flex-col gap-1 p-5 text-left", className);
  // The panel clips its corners, so the focus ring is drawn inside the cell.
  const clickable = classNames(
    classes,
    "hover:bg-surface-raised transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2",
    // On, in the accent, as a pressed ghost button shows it.
    pressed && "bg-accent-soft hover:bg-accent-soft",
  );
  if (href) {
    return (
      <Link href={href} className={clickable}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        className={clickable}
      >
        {children}
      </button>
    );
  }
  return <div className={classes}>{children}</div>;
}

/** Give it a `key` per style, tracks, view and show choice, so switching starts again from the top. */
function PersonalBests({
  steamid64,
  style,
  styleName,
  tracks,
  view,
  records,
  first,
  total,
}: {
  steamid64: string;
  /** Left out for every style, listed most recently finished first. */
  style: string | undefined;
  styleName: (key: string) => string;
  /** Left out for main tracks and bonuses together. */
  tracks: "main" | "bonuses" | undefined;
  view: View;
  /** World records alone. */
  records: boolean;
  /** The first page when it came with the profile; left out, it's loaded here. */
  first?: Pick<Schemas["PersonalBestPage"], "personal_bests" | "next_cursor">;
  /** How many there are, when known up front (2.0's counts); the other views count what they've shown. */
  total?: number;
}) {
  const [personalBests, setPersonalBests] = useState(first?.personal_bests);
  const [cursor, setCursor] = useState(first?.next_cursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  function fetchPage(after: string | undefined) {
    return api
      .GET("/v1/players/{player}/personal-bests", {
        params: {
          path: { player: steamid64 },
          query: {
            style,
            tracks,
            view,
            records: records || undefined,
            limit: PAGE_SIZE,
            cursor: after,
          },
        },
      })
      .then((result) => result.data)
      .catch(() => undefined);
  }

  function show(
    page: Schemas["PersonalBestPage"] | undefined,
    after: string | undefined,
  ) {
    if (!page) {
      setFailed(true);
      return;
    }
    setPersonalBests((shown) =>
      after && shown ? [...shown, ...page.personal_bests] : page.personal_bests,
    );
    setCursor(page.next_cursor);
  }

  async function showMore(after: string) {
    setLoading(true);
    setFailed(false);
    const page = await fetchPage(after);
    setLoading(false);
    show(page, after);
  }

  // Views other than 2.0's don't come with the profile; their first page loads once the view is chosen.
  useEffect(() => {
    if (!first) void fetchPage(undefined).then((page) => show(page, undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key remounts this for another style or view
  }, []);

  if (!personalBests) {
    return failed ? (
      <p className="text-danger text-sm">
        These personal bests couldn&apos;t be loaded. Try again.
      </p>
    ) : (
      // Held in the table's place, so choosing a view that wasn't loaded with the page doesn't leave a blank.
      <p role="status" className="text-text-muted text-sm">
        Loading…
      </p>
    );
  }
  const count = total ?? personalBests.length;
  // World records count bonuses with main tracks, so one kind of track can have none while the count doesn't.
  if (personalBests.length === 0) {
    return (
      <p className="text-text-muted">
        None
        {tracks === "main"
          ? " on main tracks"
          : tracks === "bonuses"
            ? " on bonuses"
            : ""}{" "}
        yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className="w-16">Place</TableHeaderCell>
            <TableHeaderCell>Map</TableHeaderCell>
            {!style && <TableHeaderCell>Style</TableHeaderCell>}
            <TableHeaderCell numeric>Time</TableHeaderCell>
            <TableHeaderCell numeric>Date</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {personalBests.map((pb, index) => (
            <TableRow
              key={`${pb.legacy ? "pre" : "run"}-${pb.run_id}`}
              highlight={pb.rank === 1}
              className="motion-enter"
              // Rows loaded by "Show more" stagger from the first new one, not from the top.
              style={
                {
                  "--motion-delay": `${Math.min(index % PAGE_SIZE, 12) * 20}ms`,
                } as CSSProperties
              }
            >
              <TableCell>
                {/* A legacy run has no 2.0 placement. */}
                {pb.rank == null ? (
                  <span className="text-text-muted inline-flex size-6 justify-center">
                    –
                  </span>
                ) : (
                  <Medal placement={pb.rank} />
                )}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Link
                    href={
                      pb.legacy
                        ? `/maps/${pb.map}?style=${pb.style}&view=legacy`
                        : `/maps/${pb.map}?style=${pb.style}${pb.track > 0 ? `&track=${pb.track}` : ""}`
                    }
                    className="hover:text-accent"
                  >
                    {pb.map}
                  </Link>
                  {pb.track > 0 && <Badge>Bonus {pb.track}</Badge>}
                  {pb.rank === 1 && <Badge tone="accent">WR</Badge>}
                  {pb.legacy && <LegacyBadge />}
                </span>
              </TableCell>
              {!style && (
                <TableCell className="text-text-muted">
                  {styleName(pb.style)}
                </TableCell>
              )}
              <TableCell numeric>
                {/* Legacy runs have no run page: the old site kept no more than this row. */}
                {pb.legacy ? (
                  formatTime(pb.time)
                ) : (
                  <RunLink
                    runId={pb.run_id}
                    className="hover:text-accent underline-offset-4 hover:underline"
                  >
                    {formatTime(pb.time)}
                  </RunLink>
                )}
              </TableCell>
              <TableCell numeric className="text-text-muted">
                {pb.finished_at ? (
                  <time dateTime={pb.finished_at}>
                    {formatDate(pb.finished_at)}
                  </time>
                ) : (
                  "–"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-muted text-sm tabular-nums">
          {records
            ? !cursor
              ? count === 1
                ? "1 world record"
                : `All ${count} world records`
              : `${personalBests.length} world records so far`
            : !cursor
              ? count === 1
                ? "1 personal best"
                : `All ${count} personal bests`
              : total != null
                ? `${personalBests.length} of ${total} personal bests`
                : `${personalBests.length} personal bests so far`}
        </span>
        {failed && (
          <span className="text-danger text-sm">
            More couldn&apos;t be loaded. Try again.
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
