// The home page's live part: the newest world records beside the busiest servers online right now.
import { ArrowRight } from "lucide-react";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { api, type Schemas } from "@/api/client";
import { currentStyles } from "@/features/ruleset/styles";
import { RunLink } from "@/features/runs/RunLink";
import { formatSince, formatTime, trackName } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { buttonClasses } from "@/ui/Button";
import { Card, Label } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";

const RECORDS = 6;
const SERVERS = 4;

export async function LiveNow() {
  // Read at request time, never while the site is built: the API isn't reachable then, and a build-time read
  // would be kept in the static shell.
  await connection();
  const [records, servers, styles] = await Promise.all([
    api
      .GET("/v1/runs", { params: { query: { records: true, limit: RECORDS } } })
      .catch(() => undefined),
    api.GET("/v1/servers").catch(() => undefined),
    currentStyles(),
  ]);
  return (
    <section
      className="motion-reveal grid gap-4 lg:grid-cols-5"
      aria-label="Live"
    >
      <Card className="flex flex-col gap-3 lg:col-span-3">
        <Heading href="/activity?show=records" link="All records">
          Latest world records
        </Heading>
        {records?.data ? (
          <Records
            runs={records.data.runs}
            styleName={styles.keys.length > 1 ? styles.name : undefined}
          />
        ) : (
          <p className="text-text-muted">
            Records couldn&apos;t be loaded. Try again in a moment.
          </p>
        )}
      </Card>
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <Heading href="/servers" link="All servers">
          Online now
        </Heading>
        {servers?.data ? (
          <Servers servers={servers.data.servers} />
        ) : (
          <p className="text-text-muted">
            Servers couldn&apos;t be loaded. Try again in a moment.
          </p>
        )}
      </Card>
    </section>
  );
}

function Heading({
  href,
  link,
  children,
}: {
  href: string;
  link: string;
  children: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label>{children}</Label>
      <Link
        href={href}
        className="text-text-muted hover:text-accent flex items-center gap-1 text-sm"
      >
        {link}
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}

function Records({
  runs,
  styleName,
}: {
  runs: Schemas["RecentRun"][];
  /** Given when more than one style is ranked, so each record names its own. */
  styleName?: (key: string) => string;
}) {
  if (runs.length === 0) {
    return <p className="text-text-muted">No world records yet.</p>;
  }
  return (
    <DividedList>
      {runs.map((run, index) => (
        <li
          key={run.run_id}
          className="motion-enter flex items-center gap-3 py-2.5"
          style={{ "--motion-delay": `${index * 40}ms` } as CSSProperties}
        >
          <Avatar
            name={run.player.name}
            src={run.player.avatar_url ?? undefined}
            size="sm"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <Link
                href={`/players/${run.player.steamid64}`}
                className="hover:text-accent truncate font-bold"
              >
                {run.player.name}
              </Link>
              <Flag code={run.player.country_code} />
            </span>
            <span className="text-text-muted truncate text-sm">
              <Link
                href={`/maps/${run.map}?style=${run.style}${run.track > 0 ? `&track=${run.track}` : ""}`}
                className="hover:text-accent"
              >
                {run.map}
              </Link>
              {[run.track > 0 && trackName(run.track), styleName?.(run.style)]
                .filter(Boolean)
                .map((part) => ` · ${part}`)}
            </span>
          </span>
          <span className="flex flex-col items-end">
            {/* Every row is a world record, so the time says by how much it beat the last one instead of "WR". */}
            <span className="flex items-baseline gap-2">
              {run.gap != null && run.gap < 0 && (
                <span className="text-success text-xs tabular-nums">
                  −{formatTime(-run.gap)}
                </span>
              )}
              <RunLink
                runId={run.run_id}
                className="hover:text-accent font-bold tabular-nums underline-offset-4 hover:underline"
              >
                {formatTime(run.time)}
              </RunLink>
            </span>
            <span className="text-text-subtle text-xs tabular-nums">
              {/* Counted from now, which differs between the server's render and the browser's. */}
              <time dateTime={run.finished_at} suppressHydrationWarning>
                {formatSince(run.finished_at)}
              </time>
            </span>
          </span>
        </li>
      ))}
    </DividedList>
  );
}

function Servers({ servers }: { servers: Schemas["ListedServer"][] }) {
  // The API lists online servers first, busiest first.
  const online = servers.filter((server) => server.online).slice(0, SERVERS);
  if (online.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-3">
        <p className="text-text-muted">
          No servers are online right now. The server list shows where players
          were last seen.
        </p>
        <Link href="/servers" className={buttonClasses({ size: "sm" })}>
          Server list
        </Link>
      </div>
    );
  }
  return (
    <DividedList>
      {online.map((server) => {
        const address = `${server.ip}:${server.port}`;
        return (
          <li key={address} className="flex items-center gap-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-bold">{server.hostname}</span>
              <span className="text-text-muted truncate text-sm">
                {server.map}
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm tabular-nums">
              <span aria-hidden className="bg-success size-2 rounded-full" />
              <span>
                <span className="font-bold">{server.players}</span>
                <span className="text-text-muted">/{server.max_slots}</span>
              </span>
            </span>
            <a
              href={`steam://connect/${address}`}
              className={buttonClasses({ size: "sm" })}
            >
              Join
            </a>
          </li>
        );
      })}
    </DividedList>
  );
}
