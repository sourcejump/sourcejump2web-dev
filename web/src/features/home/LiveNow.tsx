// The home page's live part, under its header: the numbers that say how busy SourceJump is (players on now, the
// latest day's runs, the week's world records), the newest world records beside the top of the points board, then
// the servers people are playing on now.
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import { api, type Schemas } from "@/api/client";
import { currentStyles } from "@/features/ruleset/styles";
import { RecordGap } from "@/features/runs/RecordGap";
import { RunLink } from "@/features/runs/RunLink";
import { ReplayLink } from "@/features/replays/ReplayLink";
import {
  formatAge,
  formatDate,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { ServerRow } from "@/features/servers/ServerRow";
import { Avatar } from "@/ui/Avatar";
import { buttonClasses } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { TierBadge } from "@/ui/TierBadge";
import { avatarSrc } from "@/features/players/avatarSrc";

const RECORDS = 8;
/**
 * Records fetched to find RECORDS boards among: a board's record often falls several times in a row, and only the
 * latest shows. shortcut: fewer than RECORDS show if the last 100 records were set on fewer boards; a `distinct`
 * option on the API would end that.
 */
const RECORDS_SCANNED = 100;
const LEADERS = 10;
const SERVERS = 4;
const numbers = new Intl.NumberFormat("en");

export async function LiveNow() {
  await connection();
  // Each part shows what it has; one that can't be loaded says so, or (a fact) leaves its number out.
  const [records, servers, leaders, runs, styles] = await Promise.all([
    api
      .GET("/v1/runs", {
        params: { query: { records: true, limit: RECORDS_SCANNED } },
      })
      .catch(() => undefined),
    api.GET("/v1/servers").catch(() => undefined),
    api
      .GET("/v1/leaderboards/{ranking}", {
        params: { path: { ranking: "points" }, query: { limit: LEADERS } },
      })
      .catch(() => undefined),
    api
      .GET("/v1/daily-totals/runs", { params: { query: { range: "month" } } })
      .catch(() => undefined),
    currentStyles(),
  ]);
  const listed = servers?.data?.servers;
  // The API lists online servers first, busiest first.
  const online = listed?.filter((server) => server.online) ?? [];
  const playing = online.reduce((sum, server) => sum + server.players, 0);
  // Where the players are, "12 playing now on 3 servers"; with nobody playing, how many servers are up to join.
  const busy = online.filter((server) => server.players > 0).length;
  const playingDetail =
    playing > 0
      ? ` on ${busy} ${busy === 1 ? "server" : "servers"}`
      : `, ${online.length} ${online.length === 1 ? "server" : "servers"} online`;
  const lastDay = runs?.data?.points.at(-1);
  const week = runs?.data?.points.slice(-7) ?? [];
  const board = leaders?.data;

  return (
    <>
      <Facts
        facts={[
          listed && {
            value: playing,
            live: true,
            text: `playing now${playingDetail}`,
            href: "/servers",
          },
          lastDay && {
            value: lastDay.runs,
            text: `${lastDay.runs === 1 ? "run" : "runs"} on ${formatDate(lastDay.day).replace(/, \d{4}$/, "")}`,
            href: "/activity",
          },
          week.length > 0 && {
            value: week.reduce((sum, day) => sum + day.world_records, 0),
            text: "world records in the last 7 days",
            href: "/activity?show=records",
          },
        ]}
      />

      {/* Side by side, the two panels end level: each list's rows share out the taller one's height. */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Latest world records"
          href="/activity?show=records"
          link="All records"
        >
          {records?.data ? (
            <Records
              runs={latestPerBoard(records.data.runs).slice(0, RECORDS)}
              tierCount={records.data.tier_count ?? null}
              styleName={styles.keys.length > 1 ? styles.name : undefined}
            />
          ) : (
            <Note>Records couldn&apos;t be loaded. Try again in a moment.</Note>
          )}
        </Panel>
        <Panel
          className="lg:col-span-2"
          title="Top players"
          href="/leaderboards"
          link="Leaderboards"
          note={
            board &&
            `${styles.name(board.style ?? styles.keys[0] ?? "")} points${board.points.draft ? ", draft" : ""}`
          }
        >
          {board ? (
            <Leaders standings={board.standings} />
          ) : (
            <Note>
              The leaderboard couldn&apos;t be loaded. Try again in a moment.
            </Note>
          )}
        </Panel>
      </div>

      <Panel title="Online now" href="/servers" link="All servers">
        {!listed ? (
          <Note>Servers couldn&apos;t be loaded. Try again in a moment.</Note>
        ) : online.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-5 pb-5">
            <p className="text-text-muted">
              No servers are online right now. The server list shows where
              players were last seen.
            </p>
            <Link href="/servers" className={buttonClasses({ size: "sm" })}>
              Server list
            </Link>
          </div>
        ) : (
          // The Servers page's own rows, two to a line, with the lines between them drawn by each cell.
          <ul className="border-border @container grid gap-2 border-t p-2 sm:-mb-px sm:gap-0 sm:p-0 lg:grid-cols-2">
            {online.slice(0, SERVERS).map((server, index) => (
              <li
                key={`${server.ip}:${server.port}`}
                className="sm:border-border sm:border-b lg:odd:border-r"
              >
                <ServerRow server={server} eager={index < 2} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

interface Fact {
  value: number;
  /** A count of what's happening right now, in the green of the servers' online dots. */
  live?: boolean;
  /** What the number counts, read after it. */
  text: string;
  href: string;
}

/**
 * How busy SourceJump is, one strip split three ways, each part opening the page it comes from. One line each, so it stays
 * short: the number, then what it counts (beneath it until the boxes are wide enough for one line).
 */
function Facts({ facts }: { facts: (Fact | false | 0 | null | undefined)[] }) {
  const shown = facts.filter((fact): fact is Fact => !!fact);
  if (shown.length === 0) return null;
  return (
    <ul
      aria-label="SourceJump now"
      className="border-border bg-surface divide-border grid grid-cols-3 divide-x overflow-hidden rounded-md border"
    >
      {shown.map((fact) => (
        <li key={fact.href} className="min-w-0">
          <Link
            href={fact.href}
            className="group hover:bg-text/4 flex h-full flex-col px-3 py-2 transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2 sm:px-4 sm:py-3 lg:flex-row lg:items-baseline lg:gap-2"
          >
            <span
              className={classNames(
                "text-lg font-bold transition-colors duration-(--duration-fast)",
                // The live count keeps the online green; the others take the accent on hover.
                fact.live ? "text-success" : "group-hover:text-accent",
              )}
            >
              {numbers.format(fact.value)}
            </span>
            <span className="text-text-muted group-hover:text-text min-w-0 text-xs transition-colors duration-(--duration-fast) sm:text-sm lg:truncate">
              {fact.text}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Panel({
  title,
  href,
  link,
  note,
  className,
  children,
}: {
  title: string;
  href: string;
  link: string;
  /** Beside the title, e.g. which board the panel shows. */
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={classNames(
        "border-border bg-surface flex min-w-0 flex-col overflow-hidden rounded-md border",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="flex items-baseline gap-2 text-lg font-bold">
          {title}
          {note && (
            <span className="text-text-subtle text-xs font-normal">{note}</span>
          )}
        </h2>
        <Link
          href={href}
          className="text-text-muted hover:text-accent shrink-0 text-sm"
        >
          {link}
        </Link>
      </div>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-text-muted px-5 pb-5">{children}</p>;
}

function Records({
  runs,
  tierCount,
  styleName,
}: {
  runs: Schemas["RecentRun"][];
  tierCount: number | null;
  /** Given when more than one style is ranked, so each record names its own. */
  styleName?: (key: string) => string;
}) {
  if (runs.length === 0) return <Note>No world records yet.</Note>;
  // The track on a bonus, and the style when more than one is ranked.
  const details = (run: Schemas["RecentRun"]) =>
    [run.track > 0 && trackName(run.track), styleName?.(run.style)]
      .filter(Boolean)
      .join(" · ");
  return (
    <ul className="divide-border border-border flex flex-1 flex-col divide-y border-t">
      {runs.map((run, index) => (
        <li
          key={run.run_id}
          className="motion-enter flex flex-1 items-center gap-3 px-5 py-2.5"
          style={{ "--motion-delay": `${index * 30}ms` } as CSSProperties}
        >
          {/* Who, then where: the player, then the map with its tier, and its style and track; then the time. Side
              by side from sm; on a phone the map takes the line under the player, the style giving way first and
              left out below 360px. */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
            <RecordHolder player={run.player} className="sm:w-44 sm:shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2 max-sm:text-sm">
                {run.tier != null && tierCount != null && (
                  <TierBadge tier={run.tier} tierCount={tierCount} />
                )}
                <Link
                  href={`/maps/${run.map}?style=${run.style}${run.track > 0 ? `&track=${run.track}` : ""}`}
                  className="hover:text-accent truncate"
                >
                  {run.map}
                </Link>
                {details(run) && (
                  <span className="text-text-subtle max-xs:hidden min-w-0 shrink-3 truncate sm:hidden">
                    {details(run)}
                  </span>
                )}
              </span>
              {details(run) && (
                <span className="text-text-subtle text-sm max-sm:hidden">
                  {details(run)}
                </span>
              )}
            </span>
          </span>
          {/* As on the Activity board: the time with what it took off the old record in brackets, how long ago
              beneath, then the replay. A phone leaves the brackets to the run's page, so the map keeps its width. */}
          <span className="flex shrink-0 flex-col items-end sm:min-w-36">
            <span className="flex items-baseline gap-1.5">
              <RunLink
                runId={run.run_id}
                className="hover:text-accent font-bold tabular-nums underline-offset-4 hover:underline"
              >
                {formatTime(run.time)}
              </RunLink>
              {/* No gap: the board's first run, a record that beat nothing. */}
              <RecordGap
                gap={run.gap ?? "new"}
                className="text-xs max-sm:hidden"
              />
            </span>
            <span className="flex items-baseline gap-1.5 text-xs leading-4">
              {/* Counted from now, which differs between the server's render and the browser's. */}
              <time
                dateTime={run.finished_at}
                suppressHydrationWarning
                className="text-text-subtle tabular-nums"
              >
                {formatAge(run.finished_at)}
              </time>
            </span>
          </span>
          <ReplayLink runId={run.run_id} />
        </li>
      ))}
    </ul>
  );
}

/** Who set a record: their avatar, name and, when Steam has it, flag (a placeholder on every row would be noise). */
function RecordHolder({
  player,
  className,
}: {
  player: Schemas["RecentRun"]["player"];
  className?: string;
}) {
  return (
    <span className={classNames("flex min-w-0 items-center gap-2", className)}>
      <Avatar name={player.name} src={avatarSrc(player)} size="sm" />
      <Link
        href={`/players/${player.steamid64}`}
        className="hover:text-accent truncate font-bold"
      >
        {player.name}
      </Link>
      {player.country_code && (
        <span className="flex shrink-0">
          <Flag code={player.country_code} />
        </span>
      )}
    </span>
  );
}

function Leaders({ standings }: { standings: Schemas["Standing"][] }) {
  if (standings.length === 0) return <Note>No one has points yet.</Note>;
  return (
    <ol className="divide-border border-border flex flex-1 flex-col divide-y border-t">
      {standings.map((standing, index) => (
        <li
          key={standing.player.steamid64}
          className="motion-enter flex flex-1"
          style={{ "--motion-delay": `${index * 30}ms` } as CSSProperties}
        >
          <Link
            href={`/players/${standing.player.steamid64}`}
            className="group hover:bg-text/4 flex min-h-14 flex-1 items-center gap-3 px-5 transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
          >
            {/* Counted down the list, not the shared rank of a tie, as on the Leaderboards page. */}
            <Medal placement={index + 1} />
            <Avatar
              name={standing.player.name}
              src={avatarSrc(standing.player)}
              size="sm"
            />
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="group-hover:text-accent min-w-0 truncate transition-colors duration-(--duration-fast)">
                {standing.player.name}
              </span>
              {standing.player.country_code && (
                <Flag code={standing.player.country_code} />
              )}
            </span>
            <span className="ml-auto shrink-0 pl-2 text-right tabular-nums">
              <span className="font-bold">
                {numbers.format(standing.points)}
              </span>
              <span className="text-text-subtle block text-xs">
                {standing.completed} {standing.completed === 1 ? "map" : "maps"}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** Each board's latest record only, newest first: one map's record falling seven times reads as seven maps' news. */
function latestPerBoard(runs: Schemas["RecentRun"][]): Schemas["RecentRun"][] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const board = `${run.map}/${run.style}/${run.track}`;
    if (seen.has(board)) return false;
    seen.add(board);
    return true;
  });
}
