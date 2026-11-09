"use client";
// A profile's style, track, view and show choice and what it shows: points rank, completed maps and world records in
// that style, then its personal bests or only its world records. Every style's 2.0 main-track first page
// arrives with the profile, so switching styles happens in place; bonuses, world records and the normal
// style's pre-2.0 views load when chosen. The counts are 2.0's in every view.
import { useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Globe,
  Trophy,
  Medal as MedalIcon,
  Star,
  Map as MapIcon,
  Gem,
} from "lucide-react";
import { ProfileHistory } from "./ProfileHistory";
import type { ProfileHistoryPoint } from "./sampleHistory";
import styles from "./PlayerStyles.module.css";
import { api, type Schemas } from "@/api/client";
import { LegacyBadge } from "@/features/legacy/LegacyBadge";
import { ReplayLink } from "@/features/replays/ReplayLink";
import {
  LEGACY_STYLE,
  type View,
  ViewMenu,
  viewFrom,
} from "@/features/legacy/views";
import { RunLink } from "@/features/runs/RunLink";
import {
  formatAge,
  formatDate,
  formatGap,
  formatTime,
} from "@/features/runs/time";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { classNames } from "@/ui/classNames";
import { CountUp } from "@/ui/CountUp";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { SortButton } from "@/ui/SortButton";
import { TierBadge } from "@/ui/TierBadge";
import {
  gapOf,
  type PbSort,
  type PbSortKey,
  sameSort,
  sortedPbs,
} from "./personalBestOrder";
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
  history,
  details,
  bonusTotal,
}: {
  player: Schemas["PlayerProfile"];
  /** Style keys in the ruleset's order. */
  styleOrder: string[];
  styleNames: Record<string, string>;
  history?: Record<string, ProfileHistoryPoint[]>;
  details?: ReactNode;
  bonusTotal?: number;
}) {
  const params = useSearchParams();
  const choiceKey = params.toString();
  const [loaded, setLoaded] = useState<{
    key: string;
    rows: Schemas["PersonalBest"][];
  }>();
  const acceptRows = useCallback(
    (rows: Schemas["PersonalBest"][]) => setLoaded({ key: choiceKey, rows }),
    [choiceKey],
  );
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
  const bonuses = counts?.completed_bonuses ?? 0;
  const maps = counts?.completed_maps ?? 0;
  const shownTotal =
    tracks === "main" ? maps : tracks === "bonuses" ? bonuses : maps + bonuses;
  const styleName = anyStyle ? "" : `${styleNames[styleKey] ?? styleKey} `;
  // The leaderboards and the map list are per style and kind of track; "any" opens their defaults.
  const boardStyle =
    anyStyle || styleKey === styleOrder[0] ? {} : { style: styleKey };

  const ranked = anyStyle
    ? styleKeys
        .map(summary)
        .find(
          (style) =>
            style &&
            (tracks === "bonuses" ? style.bonus_standing : style.main_standing),
        )
    : current;
  const standing =
    tracks === "bonuses" ? ranked?.bonus_standing : ranked?.main_standing;
  const historyStyle = ranked?.style ?? styleKey;
  const historyName = styleNames[historyStyle] ?? historyStyle;
  const rows = loaded?.key === choiceKey ? loaded.rows : undefined;
  const completeFirst =
    tracks === "main" && !records && current && !current.next_cursor
      ? current.personal_bests
      : undefined;
  const top10 =
    view !== "current"
      ? undefined
      : !shownTotal
        ? 0
        : (rows ?? completeFirst)?.filter(
            (pb) => pb.rank != null && pb.rank <= 10,
          ).length;
  const pointsStyle = ranked?.style ?? (anyStyle ? styleOrder[0] : styleKey);
  const pointsHref = withQuery("/leaderboards/points", {
    style: pointsStyle !== styleOrder[0] ? pointsStyle : undefined,
    ...(tracks === "bonuses" && { track: "bonuses" }),
  });

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
      <section
        aria-label="Player statistics"
        className="motion-enter grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        <StatLink href={pointsHref} color="var(--color-profile-rank)">
          <StatText>Global rank</StatText>
          <StatIcon>
            <Globe />
          </StatIcon>
          <StatValue>
            {standing ? `#${numbers.format(standing.rank)}` : "—"}
          </StatValue>
        </StatLink>
        <StatLink
          color="var(--color-gold)"
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
          <StatText>World records</StatText>
          <StatIcon>
            <Trophy />
          </StatIcon>
          <StatValue>
            <CountUp value={counts?.world_records ?? 0} />
          </StatValue>
        </StatLink>
        <StatLink color="var(--color-profile-top10)">
          <StatText>Top 10s</StatText>
          <StatIcon>
            <MedalIcon />
          </StatIcon>
          <StatValue>
            {top10 === undefined ? "—" : numbers.format(top10)}
          </StatValue>
        </StatLink>
        <StatLink color="var(--color-accent)">
          <StatText>Points</StatText>
          <StatIcon>
            <Star />
          </StatIcon>
          <StatValue>
            <CountUp value={standing?.points ?? 0} />
          </StatValue>
        </StatLink>
        <StatLink
          color="var(--color-profile-maps)"
          href={withQuery("/maps", {
            player: player.steamid64,
            completed: "yes",
            ...boardStyle,
          })}
        >
          <StatText>Maps completed</StatText>
          <StatIcon>
            <MapIcon />
          </StatIcon>
          <StatValue>
            <CountUp value={maps} />
            <span className="text-text-muted text-sm font-normal">
              {" "}
              / {numbers.format(player.map_count)}
            </span>
          </StatValue>
          {player.map_count > 0 && (
            <span
              aria-hidden
              className="bg-surface-overlay absolute inset-x-0 bottom-0 h-1"
            >
              <span
                className={classNames("block h-full", styles.progress)}
                style={{
                  width: `${Math.min(100, (maps / player.map_count) * 100)}%`,
                }}
              />
            </span>
          )}
        </StatLink>
        <StatLink color="var(--color-success)">
          <StatText>Bonuses completed</StatText>
          <StatIcon>
            <Gem />
          </StatIcon>
          <StatValue>
            <CountUp value={bonuses} />
            {bonusTotal != null && (
              <span className="text-text-muted text-sm font-normal">
                {" "}
                / {numbers.format(bonusTotal)}
              </span>
            )}
          </StatValue>
          {bonusTotal != null && bonusTotal > 0 && (
            <span
              aria-hidden
              className="bg-surface-overlay absolute inset-x-0 bottom-0 h-1"
            >
              <span
                className={classNames("block h-full", styles.progress)}
                style={{
                  width: `${Math.min(100, (bonuses / bonusTotal) * 100)}%`,
                }}
              />
            </span>
          )}
        </StatLink>
      </section>
      <ProfileHistory
        series={
          history?.[
            `${historyStyle}:${tracks === "bonuses" ? "bonuses" : "main"}`
          ]
        }
        styleName={historyName}
        bonuses={tracks === "bonuses"}
      />
      {details}

      {/* The choices sit with the list they narrow, under the overview. */}
      <div className="flex flex-col gap-3">
        <ChoiceBar>
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
            // Its values ("All runs", "World records") say what it is, so a phone leaves the word out.
            label={<span className="max-sm:hidden">Show</span>}
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
            onLoaded={acceptRows}
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
            tierCount={player.tier_count ?? undefined}
            // The world record count covers main tracks and bonuses together, so it can't total one of them; across
            // styles the counts are of maps, not of each style's personal best on them.
            total={
              view === "current" && !records && !anyStyle
                ? shownTotal
                : undefined
            }
          />
        )}
      </div>
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

/**
 * One cell of the standing panel: opens the page its number comes from, or changes the view. With neither,
 * it's a plain cell.
 */
function StatLink({
  href,
  onClick,
  pressed,
  color,
  className,
  children,
}: {
  href?: string;
  onClick?: () => void;
  /** For a cell that switches a view: whether that view is showing. */
  pressed?: boolean;
  color: string;
  className?: string;
  children: ReactNode;
}) {
  const classes = classNames(
    "group border-border bg-surface relative flex min-h-28 min-w-0 flex-col gap-3 overflow-hidden rounded-md border p-4 text-left sm:p-5",
    styles.stat,
    className,
  );
  const style = { "--stat-color": color } as CSSProperties;
  // The panel clips its corners, so the focus ring is drawn inside the cell.
  const clickable = classNames(
    classes,
    "hover:bg-text/4 transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2",
    // On, in the accent, as a pressed ghost button shows it.
    pressed && "bg-accent-soft hover:bg-accent-soft",
  );
  if (href) {
    return (
      <Link href={href} className={clickable} style={style}>
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
        style={style}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}

/** A standing cell's number, accented on hover as at home. */
function StatValue({ children }: { children: ReactNode }) {
  return (
    <span className="group-hover:text-accent flex min-w-0 flex-wrap items-baseline gap-x-2 text-xl font-bold tabular-nums transition-colors duration-(--duration-fast) sm:text-2xl">
      {children}
    </span>
  );
}

/** What a standing cell's number counts. */
function StatText({ children }: { children: ReactNode }) {
  return (
    <span className="text-text-muted group-hover:text-text min-h-10 min-w-0 pr-8 text-sm transition-colors duration-(--duration-fast)">
      {children}
    </span>
  );
}

function StatIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={classNames(
        "absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-md sm:top-5 sm:right-5 [&_svg]:size-4",
        styles.icon,
      )}
    >
      {children}
    </span>
  );
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
  tierCount,
  onLoaded,
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
  /** Tiers in force, for the badges; undefined until the community sets tiers. */
  tierCount?: number;
  onLoaded: (rows: Schemas["PersonalBest"][]) => void;
}) {
  // The API's own order: by map in one style, newest first across styles.
  const apiOrder: PbSort = style
    ? { key: "map", descending: false }
    : { key: "date", descending: true };
  // Best place first, what a profile is read for. Pre-2.0 runs have no place, so their views keep the API's order.
  const defaultSort: PbSort =
    view === "current" ? { key: "place", descending: false } : apiOrder;
  const sortsAll = !sameSort(defaultSort, apiOrder);
  // A first page that isn't the whole list waits for the rest, so the table doesn't reorder under the reader.
  const [personalBests, setPersonalBests] = useState(
    sortsAll && first?.next_cursor ? undefined : first?.personal_bests,
  );
  const [cursor, setCursor] = useState(first?.next_cursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<PbSort>(defaultSort);

  function fetchPage(after: string | undefined, limit = PAGE_SIZE) {
    return api
      .GET("/v1/players/{player}/personal-bests", {
        params: {
          path: { player: steamid64 },
          query: {
            style,
            tracks,
            view,
            records: records || undefined,
            limit,
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

  /**
   * Any order but the API's needs every row: loads the rest after `shown`, `loading` being set already. False if a
   * page failed.
   * shortcut: loads every personal best in the browser, 100 a request; fine for the few hundred 2.0 runs a player has
   * in a style, ask the API for a `sort` parameter if lists grow to thousands.
   */
  async function loadAll(
    shown: Schemas["PersonalBest"][],
    after: string | null | undefined,
  ) {
    let all = shown;
    while (after) {
      const page = await fetchPage(after, FULL_PAGE_SIZE);
      if (!page) {
        setLoading(false);
        setFailed(true);
        return false;
      }
      all = [...all, ...page.personal_bests];
      after = page.next_cursor;
    }
    setPersonalBests(all);
    setCursor(undefined);
    setLoading(false);
    return true;
  }

  /** Sorts by a column; again on the same one turns it around. */
  async function sortBy(key: PbSortKey) {
    const next: PbSort =
      sort.key === key
        ? { key, descending: !sort.descending }
        : { key, descending: key === "date" };
    if (!sameSort(next, apiOrder) && cursor) {
      setLoading(true);
      setFailed(false);
      if (!(await loadAll(personalBests ?? [], cursor))) return;
    }
    setSort(next);
  }

  // Views other than 2.0's don't come with the profile; their first page loads once the view is chosen. An order
  // the API doesn't give loads the rest straight away.
  useEffect(() => {
    const start = first ? Promise.resolve(first) : fetchPage(undefined);
    void start.then((page) => {
      if (sortsAll && page?.next_cursor) {
        setLoading(true);
        void loadAll(page.personal_bests, page.next_cursor);
      } else show(page, undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key remounts this for another style or view
  }, []);

  useEffect(() => {
    if (personalBests && !cursor && !loading && !failed)
      onLoaded(personalBests);
  }, [personalBests, cursor, loading, failed, onLoaded]);

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

  const heading = (key: PbSortKey, label: string) => (
    <SortButton
      label={label}
      // The default order needs no arrow; it only shows once someone picks another.
      active={sort.key === key && !sameSort(sort, defaultSort)}
      descending={sort.descending}
      onClick={() => void sortBy(key)}
    />
  );
  const ariaSort = (key: PbSortKey) =>
    sort.key === key
      ? sort.descending
        ? ("descending" as const)
        : ("ascending" as const)
      : undefined;
  const rows = sameSort(sort, apiOrder)
    ? personalBests
    : sortedPbs(personalBests, sort, styleName);

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
            {/* As on a map's board: Place centered over its medals, the play button close beside the time. On a
                phone the style goes under the map and the date becomes an age under the time, so the row fits
                without scrolling. */}
            <TableHeaderCell
              centered
              className="w-px max-sm:px-2"
              aria-sort={ariaSort("place")}
            >
              {heading("place", "Place")}
            </TableHeaderCell>
            <TableHeaderCell
              className="max-sm:px-2"
              aria-sort={ariaSort("map")}
            >
              {heading("map", "Map")}
            </TableHeaderCell>
            {!style && (
              <TableHeaderCell
                className="max-sm:hidden"
                aria-sort={ariaSort("style")}
              >
                {heading("style", "Style")}
              </TableHeaderCell>
            )}
            <TableHeaderCell
              numeric
              className="pr-2"
              aria-sort={ariaSort("time")}
            >
              {heading("time", "Time")}
            </TableHeaderCell>
            <TableHeaderCell className="w-px pr-0 pl-0">
              <span className="sr-only">Replay</span>
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
          {rows.map((pb, index) => (
            <TableRow
              key={`${pb.legacy ? "pre" : "run"}-${pb.run_id}`}
              className="motion-enter"
              // Rows loaded by "Show more" stagger from the first new one, not from the top.
              style={
                {
                  "--motion-delay": `${Math.min(index % PAGE_SIZE, 12) * 20}ms`,
                } as CSSProperties
              }
            >
              <TableCell className="text-center max-sm:px-2">
                {/* A legacy run has no 2.0 placement. */}
                <span className="inline-flex justify-center align-middle">
                  {pb.rank == null ? (
                    <span className="text-text-muted inline-flex size-6 justify-center">
                      –
                    </span>
                  ) : (
                    <Medal placement={pb.rank} />
                  )}
                </span>
              </TableCell>
              <TableCell className="max-sm:w-full max-sm:max-w-0 max-sm:px-2">
                <span className="flex min-w-0 items-center gap-2">
                  {pb.tier != null && tierCount != null && (
                    <TierBadge tier={pb.tier} tierCount={tierCount} />
                  )}
                  <Link
                    href={
                      pb.legacy
                        ? `/maps/${pb.map}?style=${pb.style}&view=legacy`
                        : `/maps/${pb.map}?style=${pb.style}${pb.track > 0 ? `&track=${pb.track}` : ""}`
                    }
                    title={pb.map}
                    className="hover:text-accent truncate"
                  >
                    {pb.map}
                  </Link>
                  {pb.track > 0 && <Badge>Bonus {pb.track}</Badge>}
                  {pb.rank === 1 && <Badge tone="accent">WR</Badge>}
                  {pb.legacy && <LegacyBadge />}
                </span>
                {!style && (
                  <span className="text-text-subtle block text-xs sm:hidden">
                    {styleName(pb.style)}
                  </span>
                )}
              </TableCell>
              {!style && (
                <TableCell className="text-text-muted max-sm:hidden">
                  {styleName(pb.style)}
                </TableCell>
              )}
              <TableCell numeric className="pr-2 max-sm:pl-2">
                <span className="inline-flex flex-col items-end">
                  <span className="flex items-baseline gap-1.5">
                    {/* Legacy runs have no run page: the old site kept no more than this row. */}
                    {pb.legacy ? (
                      formatTime(pb.time)
                    ) : (
                      <RunLink
                        runId={pb.run_id}
                        className="hover:text-accent font-bold underline-offset-4 hover:underline"
                      >
                        {formatTime(pb.time)}
                      </RunLink>
                    )}
                    {/* The gap to the board's record, beside the time at every width. */}
                    <Gap pb={pb} className="text-xs" />
                  </span>
                  {pb.finished_at && (
                    // Counted from now, which differs between the server's render and the browser's.
                    <time
                      dateTime={pb.finished_at}
                      suppressHydrationWarning
                      className="text-text-subtle text-xs leading-4 sm:hidden"
                    >
                      {formatAge(pb.finished_at)}
                    </time>
                  )}
                </span>
              </TableCell>
              <TableCell className="pr-0 pl-0">
                {/* Replays open by 2.0 run ID; a pre-2.0 run's ID is the old site's. */}
                {!pb.legacy && <ReplayLink runId={pb.run_id} />}
              </TableCell>
              <TableCell numeric className="text-text-muted max-sm:hidden">
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

/** The API's largest page, for loading a whole list to sort. */
const FULL_PAGE_SIZE = 100;

/** The gap to the board's record in brackets, red, as on Activity; nothing for the record or a legacy run. */
function Gap({
  pb,
  className,
}: {
  pb: Schemas["PersonalBest"];
  className?: string;
}) {
  const gap = gapOf(pb);
  if (gap == null || gap <= 0) return null;
  return (
    <span className={classNames("text-danger tabular-nums", className)}>
      ({formatGap(gap)})
    </span>
  );
}
