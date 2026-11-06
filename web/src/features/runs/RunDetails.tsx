// A run's own page content, loaded on the server: the map and who ran it, the time, the run's numbers, then
// the replay (or a note that there's none), the comments and, for staff, the staff card.
import { Play } from "lucide-react";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { api, type Schemas } from "@/api/client";
import { MapImage } from "@/features/maps/MapImage";
import { REPLAY_ANCHOR } from "@/features/replays/anchor";
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
import {
  formatAge,
  formatDate,
  formatGap,
  formatTime,
  trackName,
} from "./time";
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
  const board = `/maps/${run.map}?style=${run.style}&track=${run.track}`;
  return (
    <>
      <RunHeader run={run} styleName={styles.name(run.style)} board={board} />
      <RunTime run={run} board={board} />
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

/** The map's picture and name with the board's tier, style and track, then who ran it and when. */
function RunHeader({
  run,
  styleName,
  board,
}: {
  run: Schemas["RunDetail"];
  styleName: string;
  board: string;
}) {
  return (
    <header className="flex items-center gap-4 sm:gap-5">
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
          <time dateTime={run.finished_at}>{formatDate(run.finished_at)}</time>
          <span aria-hidden>·</span>
          <span>{formatAge(run.finished_at)}</span>
        </p>
      </div>
    </header>
  );
}

/** The time, large, with how far it is behind the record, and what has happened to the run since. */
function RunTime({ run, board }: { run: Schemas["RunDetail"]; board: string }) {
  const gap =
    run.world_record_time == null ? 0 : run.time - run.world_record_time;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-4xl font-bold tabular-nums">
            {formatTime(run.time)}
          </span>
          {gap > 0 && (
            <span className="text-danger tabular-nums">{formatGap(gap)}</span>
          )}
          {/* Badges sit centred on the time; the gap above stays on its baseline, read as part of the time. */}
          {run.rank === 1 && (
            <Badge tone="accent" className="self-center">
              WR
            </Badge>
          )}
          {run.invalidated && (
            <Badge tone="danger" className="self-center">
              Invalidated
            </Badge>
          )}
        </p>
        {run.invalidated ? (
          <p className="text-text-muted text-sm">
            Staff invalidated this run, so it isn&apos;t on the leaderboards.
          </p>
        ) : (
          !run.personal_best && (
            <p className="text-text-muted text-sm">
              A faster run has replaced this one as {run.player.name}&apos;s
              personal best.
            </p>
          )
        )}
      </div>
      <div className="flex gap-2">
        {run.replay && (
          <ButtonLink href={`#${REPLAY_ANCHOR}`} variant="primary" size="sm">
            <Play aria-hidden />
            Watch replay
          </ButtonLink>
        )}
        <ButtonLink href={board} size="sm">
          Leaderboard
        </ButtonLink>
      </div>
    </div>
  );
}

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const speed = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** The run's numbers in one row, and the server it was played on. */
function RunNumbers({ run }: { run: Schemas["RunDetail"] }) {
  return (
    <Card className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
        <Stat term="Place">{run.rank == null ? "—" : `#${run.rank}`}</Stat>
        <Stat term="Jumps">{run.jumps}</Stat>
        <Stat term="Strafes">{run.strafes}</Stat>
        <Stat term="Sync">{number.format(run.sync)}%</Stat>
        <Stat term="Perfs">{number.format(run.perfs)}%</Stat>
        <Stat term="Avg speed">{speed.format(run.avg_velocity)}</Stat>
        <Stat term="Max speed">{speed.format(run.max_velocity)}</Stat>
      </dl>
      <p className="border-border text-text-muted border-t pt-3 text-sm">
        {run.server_name}
        {run.server_address && <> · {run.server_address}</>}
      </p>
    </Card>
  );
}

function Stat({ term, children }: { term: string; children: ReactNode }) {
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
    <div className="border-border bg-surface relative flex h-48 items-center justify-center overflow-hidden rounded-lg border sm:h-64">
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
