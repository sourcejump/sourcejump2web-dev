"use client";
// A profile's style, track, view and show choice and what it shows: points rank, completed maps and world records in
// that style, then its personal bests or only its world records. Every style's 2.0 main-track first page
// arrives with the profile, so switching styles happens in place; bonuses, world records and the normal
// style's pre-2.0 views load when chosen. The counts are 2.0's in every view.
import { useSearchParams } from "next/navigation";
import { History, Search } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { LegacyBadge } from "@/features/legacy/LegacyBadge";
import {
  LEGACY_STYLE,
  type View,
  ViewMenu,
  viewFrom,
} from "@/features/legacy/views";
import {
  ReplayCell,
  ReplayHeaderCell,
  TIME_BESIDE_REPLAY,
} from "@/features/replays/ReplayLink";
import { RunLink } from "@/features/runs/RunLink";
import { formatDate, formatGap, formatTime } from "@/features/runs/time";
import { ActivityCalendar } from "./ActivityCalendar";
import { loadRuns, RunsDialog, type RunsDialogBoard } from "./RunsDialog";
import { StyleOverview } from "./StyleOverview";
import { TierProgress } from "./TierProgress";
import { Badge } from "@/ui/Badge";
import { Card, Label } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import { CountUp } from "@/ui/CountUp";
import { Input } from "@/ui/Input";
import { seriesColor } from "@/ui/series";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
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
const numbers = new Intl.NumberFormat("en");
/** The Style and Track menus' choice of every style or every track. */
const ANY = "any";

type Tracks = "main" | "bonuses" | typeof ANY;

export function PlayerStyles({
  player,
  styleOrder,
  styleNames,
  today,
}: {
  player: Schemas["PlayerProfile"];
  /** Today's UTC date, `YYYY-MM-DD`, for the year of activity. */
  today: string;
  /** Style keys in the ruleset's order. */
  styleOrder: string[];
  styleNames: Record<string, string>;
}) {
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
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
  // A profile opens on the style with the most 2.0 personal bests, whose first page comes with it. Pre-2.0 runs
  // don't count toward that, so they're the pick only for a player with no 2.0 runs.
  const personalBests = (s: Schemas["PlayerStyle"]) =>
    s.completed_maps + s.completed_bonuses;
  const mostPlayed = player.styles.reduce<Schemas["PlayerStyle"] | undefined>(
    (most, s) => (!most || personalBests(s) > personalBests(most) ? s : most),
    undefined,
  )?.style;
  const styleKey =
    [ANY, ...styleKeys].find((key) => key === params.get("style")) ??
    mostPlayed ??
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
    q?: string;
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
    const nextQ = choice.q ?? q;
    if (nextQ) url.searchParams.set("q", nextQ);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="motion-enter flex flex-col gap-4">
          <div className="flex h-5 items-center justify-between gap-4">
            <Label>Personal bests by style</Label>
            {/* Kept in place while hidden, so choosing a style doesn't shift the card. */}
            <button
              type="button"
              onClick={() => choose({ style: ANY })}
              className={classNames(
                "text-text-muted hover:text-accent text-xs transition-colors duration-(--duration-fast)",
                anyStyle && "invisible",
              )}
            >
              All styles
            </button>
          </div>
          <StyleOverview
            styles={styleKeys.map((key, index) => {
              const style = summary(key);
              return {
                key,
                name: styleNames[key] ?? key,
                count:
                  (style?.completed_maps ?? 0) +
                  (style?.completed_bonuses ?? 0),
                color: seriesColor(index),
              };
            })}
            selected={anyStyle ? undefined : styleKey}
            href={(style) => `/players/${player.steamid64}?style=${style}`}
            onChoose={(style) => choose({ style })}
          />
          <div className="border-border mt-auto grid grid-cols-3 gap-3 border-t pt-4">
            {/* Each figure opens what it comes from. The rank is the style's points leaderboard place, on
                main tracks unless bonuses are shown; styles count apart, so any style has none. */}
            <Figure
              label="Rank"
              value={standing?.rank ?? null}
              detail={
                anyStyle
                  ? "per style"
                  : standing
                    ? `${numbers.format(standing.points)} points${player.points_draft ? " · draft" : ""}`
                    : undefined
              }
              href={withQuery(
                "/leaderboards/points",
                view === "legacy"
                  ? { view: "legacy" }
                  : {
                      ...boardStyle,
                      ...(tracks === "bonuses" && { track: "bonuses" }),
                    },
              )}
            />
            <Figure
              label="Completed maps"
              value={maps}
              detail={`of ${numbers.format(player.map_count)}${bonuses > 0 ? ` · ${bonuses} ${bonuses === 1 ? "bonus" : "bonuses"}` : ""}`}
              href={withQuery("/maps", {
                player: player.steamid64,
                completed: "yes",
                ...boardStyle,
              })}
            />
            {/* Every world record, newest first: any style, any track, 2.0 runs. */}
            <Figure
              label="World records"
              value={counts?.world_records ?? 0}
              onClick={() =>
                choose({
                  style: ANY,
                  tracks: ANY,
                  records: true,
                })
              }
            />
          </div>
        </Card>
        <Card
          className="motion-enter flex flex-col gap-4"
          style={{ "--motion-delay": "40ms" } as CSSProperties}
        >
          <div className="flex h-5 items-center justify-between gap-4">
            <Label>
              Completed by tier ·{" "}
              {anyStyle ? "Any style" : (styleNames[styleKey] ?? styleKey)}
            </Label>
            {player.tier_count != null && (
              <span className="text-text-muted text-xs tabular-nums">
                {numbers.format(maps)} {maps === 1 ? "map" : "maps"}
              </span>
            )}
          </div>
          {player.tier_count == null ? (
            <p className="text-text-muted text-sm">
              Maps have no tiers yet, so there&apos;s nothing to count by tier.
            </p>
          ) : (
            <TierProgress
              totals={player.maps_by_tier}
              completed={
                (anyStyle ? player.all_styles : current)?.completed_by_tier ??
                []
              }
              styleName={
                anyStyle ? "any style" : (styleNames[styleKey] ?? styleKey)
              }
              href={(tier, finished) =>
                withQuery("/maps", {
                  player: player.steamid64,
                  completed: finished ? "yes" : "no",
                  tier: String(tier),
                  ...boardStyle,
                })
              }
            />
          )}
        </Card>
      </div>

      <ActivityCalendar days={player.activity} today={today} />

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
        <PersonalBestSearch
          q={q}
          onSearch={(next) => choose({ q: next })}
          className="w-full sm:ml-auto sm:w-64"
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
          key={`${styleKey}-${tracks}-${view}-${records}-${q}`}
          steamid64={player.steamid64}
          style={anyStyle ? undefined : styleKey}
          styleName={(key) => styleNames[key] ?? key}
          tracks={tracks === ANY ? undefined : tracks}
          view={view}
          records={records}
          q={q}
          first={
            view === "current" && tracks === "main" && current && !records && !q
              ? {
                  personal_bests: current.personal_bests,
                  next_cursor: current.next_cursor,
                }
              : undefined
          }
          // The world record count covers main tracks and bonuses together, so it can't total one of them.
          total={view === "current" && !records && !q ? shownTotal : undefined}
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

/** One of the style card's figures: a label over a number, with a short detail beside it, opening what it
 * counts. `null` shows a dash. */
function Figure({
  label,
  value,
  detail,
  href,
  onClick,
}: {
  label: string;
  value: number | null;
  detail?: string;
} & (
  { href: string; onClick?: never } | { href?: never; onClick: () => void }
)) {
  const content = (
    <>
      <Label>{label}</Label>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xl font-bold tabular-nums">
          {value == null ? "–" : <CountUp value={value} />}
        </span>
        {detail && <span className="text-text-muted text-xs">{detail}</span>}
      </span>
    </>
  );
  const className =
    "hover:bg-surface-raised -m-2 flex min-w-0 flex-col gap-1 rounded-md p-2 text-left transition-colors duration-(--duration-fast)";
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

/** Long enough to skip the keystrokes in the middle of a word, short enough to feel like it follows along. */
const SEARCH_PAUSE_MS = 300;

/** Searches the personal bests below by map name once typing pauses, as the Maps page's search does. */
function PersonalBestSearch({
  q,
  onSearch,
  className,
}: {
  q: string;
  onSearch: (q: string) => void;
  className?: string;
}) {
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <form
      role="search"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        onSearch(value.trim());
      }}
    >
      <Input
        icon={Search}
        type="search"
        value={value}
        onChange={(event) => {
          const text = event.target.value;
          setValue(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(
            () => onSearch(text.trim()),
            SEARCH_PAUSE_MS,
          );
        }}
        placeholder="Search maps"
        aria-label="Search this player's personal bests by map"
        size="sm"
      />
    </form>
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
  q,
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
  /** A map name search; empty for every map. */
  q: string;
  /** The first page when it came with the profile; left out, it's loaded here. */
  first?: Pick<Schemas["PersonalBestPage"], "personal_bests" | "next_cursor">;
  /** How many there are, when known up front (2.0's counts); the other views count what they've shown. */
  total?: number;
}) {
  const [personalBests, setPersonalBests] = useState(first?.personal_bests);
  const [cursor, setCursor] = useState(first?.next_cursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [runsOf, setRunsOf] = useState<RunsDialogBoard>();
  const runsBoard = (pb: Schemas["PersonalBest"]): RunsDialogBoard => ({
    map: pb.map,
    style: pb.style,
    styleName: styleName(pb.style),
    track: pb.track,
    runs: pb.runs,
  });

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
            q: q || undefined,
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
    ) : null;
  }
  const count = total ?? personalBests.length;
  // World records count bonuses with main tracks, so one kind of track can have none while the count doesn't.
  if (personalBests.length === 0) {
    if (q) {
      return <p className="text-text-muted">No maps match “{q}”.</p>;
    }
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
            {/* A phone leaves out the style and the date, so the time shows without scrolling sideways. */}
            {!style && (
              <TableHeaderCell className="hidden sm:table-cell">
                Style
              </TableHeaderCell>
            )}
            <TableHeaderCell className="w-20">Runs</TableHeaderCell>
            <TableHeaderCell numeric className={TIME_BESIDE_REPLAY}>
              Time
            </TableHeaderCell>
            <ReplayHeaderCell />
            <TableHeaderCell numeric className="hidden sm:table-cell">
              Date
            </TableHeaderCell>
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
                    className="hover:text-accent max-w-32 truncate sm:max-w-none"
                  >
                    {pb.map}
                  </Link>
                  {pb.track > 0 && <Badge>Bonus {pb.track}</Badge>}
                  {pb.rank === 1 && <Badge tone="accent">WR</Badge>}
                  {pb.legacy && <LegacyBadge />}
                </span>
              </TableCell>
              {!style && (
                <TableCell className="text-text-muted hidden sm:table-cell">
                  {styleName(pb.style)}
                </TableCell>
              )}
              <TableCell>
                {/* Only boards with runs besides the personal best have more to show. */}
                {pb.runs > 1 && (
                  <button
                    type="button"
                    // Loading starts on the way to the click, so the dialog usually opens with its runs.
                    onPointerEnter={() =>
                      void loadRuns(steamid64, runsBoard(pb))
                    }
                    onFocus={() => void loadRuns(steamid64, runsBoard(pb))}
                    onClick={() => setRunsOf(runsBoard(pb))}
                    aria-label={`${pb.runs} runs on ${pb.map}`}
                    className="text-text-muted hover:text-accent hover:border-border hover:bg-surface-raised inline-flex items-center gap-1 rounded-sm border border-transparent px-1.5 py-0.5 text-xs tabular-nums transition-colors duration-(--duration-fast)"
                  >
                    <History aria-hidden className="size-3.5" />
                    {pb.runs}
                  </button>
                )}
              </TableCell>
              <TableCell numeric className={TIME_BESIDE_REPLAY}>
                {/* How far behind the board's world record it is now, as Activity shows against the record a run faced. */}
                {pb.rank !== 1 && pb.world_record_time != null && (
                  <span className="text-text-subtle mr-2 hidden text-xs sm:inline">
                    {formatGap(pb.time - pb.world_record_time)}
                  </span>
                )}
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
              <ReplayCell runId={pb.run_id} hasReplay={pb.has_replay} />
              <TableCell
                numeric
                className="text-text-muted hidden sm:table-cell"
              >
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
      <RunsDialog
        steamid64={steamid64}
        board={runsOf}
        onClose={() => setRunsOf(undefined)}
      />
      <ListFooter
        summary={
          records
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
                : `${personalBests.length} personal bests so far`
        }
        onShowMore={cursor ? () => void showMore(cursor) : undefined}
        loading={loading}
        failed={failed}
      />
    </div>
  );
}
