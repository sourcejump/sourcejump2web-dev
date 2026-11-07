// A run's own page content, loaded on the server: one band with the map, who ran it and the time, the run's
// numbers and where it was played, then the replay (or a note that there's none), the comments and, for staff,
// the staff card. Kept short, so the replay starts within the first screen.
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { api, type Schemas } from "@/api/client";
import { MapImage } from "@/features/maps/MapImage";
import { ReplayPlayer } from "@/features/replays/ReplayPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { RunStaff } from "@/features/staff/runs/RunStaff";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { ButtonLink } from "@/ui/Button";
import { Card, Label } from "@/ui/Card";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { TierBadge } from "@/ui/TierBadge";
import { loadGapWhenFinished } from "./loadGapWhenFinished";
import { RecordGap } from "./RecordGap";
import { formatAge, formatDate, formatTime, trackName } from "./time";
import { RunComments } from "./RunComments";

/** One request per run, however many components on the page show it. */
export const getRun = cache(async (id: string) => {
  if (!/^\d+$/.test(id)) notFound();
  const result = await api
    .GET("/v1/runs/{id}", { params: { path: { id: Number(id) } } })
    .catch(() => undefined);
  if (result?.response.status === 404) notFound();
  return result?.data;
});

export async function RunDetails({ id }: { id: string }) {
  const [run, styles] = await Promise.all([getRun(id), currentStyles()]);
  if (!run) {
    return (
      <Card>
        <p>This run couldn&apos;t be loaded. Try again in a moment.</p>
      </Card>
    );
  }
  const gap = await loadGapWhenFinished(run);
  const board = `/maps/${run.map}?style=${run.style}&track=${run.track}`;
  return (
    <>
      <RunHeader
        run={run}
        styleName={styles.name(run.style)}
        board={board}
        gap={gap}
      />
      <RunNumbers run={run} />
      {run.replay ? (
        <ReplayPlayer
          run={run}
          styleNames={Object.fromEntries(
            styles.keys.map((key) => [key, styles.name(key)]),
          )}
        />
      ) : (
        <NoReplay run={run} />
      )}
      <RunComments run={run.id} runner={run.player} />
      <RunStaff run={run} />
    </>
  );
}

/** The map's picture, name and board, who ran it and when; beside them, the time and how it stood. */
function RunHeader({
  run,
  styleName,
  board,
  gap,
}: {
  run: Schemas["RunDetail"];
  styleName: string;
  board: string;
  gap: number | null;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <Link href={board} className="shrink-0" aria-label={run.map}>
          <MapImage image={run.map_image} size="tile" />
        </Link>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-2xl font-bold sm:text-3xl">
              <Link href={board} className="hover:text-accent">
                {run.map}
              </Link>
            </h1>
            {run.tier != null && run.tier_count != null && (
              <TierBadge tier={run.tier} tierCount={run.tier_count} />
            )}
            <Badge>{styleName}</Badge>
            <Badge>{trackName(run.track)}</Badge>
          </div>
          <p className="text-text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            Run by
            <Link
              href={`/players/${run.player.steamid64}`}
              className="text-text hover:text-accent inline-flex items-center gap-1.5 font-medium"
            >
              <Avatar
                name={run.player.name}
                src={run.player.avatar_url ?? undefined}
                size="sm"
              />
              {run.player.name}
              <Flag code={run.player.country_code} />
            </Link>
            <span aria-hidden>·</span>
            <time dateTime={run.finished_at}>
              {formatDate(run.finished_at)}
            </time>
            <span aria-hidden>·</span>
            {/* Counted from now, which differs between the server's render and the browser's. */}
            <span suppressHydrationWarning>{formatAge(run.finished_at)}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 sm:items-end">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
          {run.invalidated && <Badge tone="danger">Invalidated</Badge>}
          {run.rank === 1 && <Badge tone="accent">WR</Badge>}
          <p className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">
              {formatTime(run.time)}
            </span>
            {gap != null && <RecordGap gap={gap} />}
          </p>
        </div>
        <p className="text-text-muted flex items-center gap-3 text-sm sm:justify-end">
          {run.invalidated
            ? "Staff invalidated this run, so it isn't on the leaderboards."
            : !run.personal_best
              ? `A faster run has replaced this one as ${run.player.name}'s personal best.`
              : null}
          <ButtonLink href={board} size="sm">
            Leaderboard
          </ButtonLink>
        </p>
      </div>
    </header>
  );
}

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const speed = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** The run's numbers in one row, and below them the server it was played on. */
function RunNumbers({ run }: { run: Schemas["RunDetail"] }) {
  return (
    <section className="border-border bg-surface rounded-md border">
      <dl className="grid grid-cols-4 gap-x-4 gap-y-4 px-5 py-4 sm:gap-x-6 lg:grid-cols-7">
        <Stat term="Place">{run.rank == null ? "–" : `#${run.rank}`}</Stat>
        <Stat term="Jumps">{run.jumps}</Stat>
        <Stat term="Strafes">{run.strafes}</Stat>
        <Stat term="Sync">{number.format(run.sync)}%</Stat>
        <Stat term="Perfs">{number.format(run.perfs)}%</Stat>
        {/* Shorter on phones, where four columns leave no room for "speed" on one line. */}
        <Stat term={<Speed kind="Avg" />}>
          {speed.format(run.avg_velocity)}
        </Stat>
        <Stat term={<Speed kind="Max" />}>
          {speed.format(run.max_velocity)}
        </Stat>
      </dl>
      <p className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-5 py-3 text-sm">
        <Label>Played on</Label>
        <span className="font-medium">{run.server_name}</span>
        {run.server_address && (
          <span className="text-text-muted tabular-nums">
            {run.server_address}
          </span>
        )}
        <span className="text-text-subtle">
          {speed.format(run.tickrate)} tick
        </span>
      </p>
    </section>
  );
}

function Speed({ kind }: { kind: "Avg" | "Max" }) {
  return (
    <>
      {kind}
      <span className="sm:hidden"> u/s</span>
      <span className="max-sm:hidden"> speed</span>
    </>
  );
}

function Stat({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt>
        <Label>{term}</Label>
      </dt>
      <dd className="text-xl font-bold tabular-nums">{children}</dd>
    </div>
  );
}

/** Where the replay would be, so the page keeps its shape and says why there's nothing to play. */
function NoReplay({ run }: { run: Schemas["RunDetail"] }) {
  return (
    <div className="border-border bg-surface relative flex h-48 items-center justify-center overflow-hidden rounded-md border sm:h-64">
      {run.map_image && (
        // The map's picture, dimmed, so the empty space still reads as this map. Decorative only.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={run.map_image.url}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover opacity-15 blur-sm"
        />
      )}
      <p className="text-text-muted relative text-sm">
        No replay is available for this run.
      </p>
    </div>
  );
}
