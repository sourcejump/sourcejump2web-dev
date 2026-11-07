// Everything public about one run, as a compact list: the run dialog's content and the `/runs/{id}` page.
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { DividedList } from "@/ui/Divided";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { RecordGap } from "./RecordGap";
import { formatDate, formatTime, trackName } from "./time";
import { avatarSrc } from "@/features/players/avatarSrc";

export function RunDetailList({
  run,
  styleName,
  gap,
}: {
  run: Schemas["RunDetail"];
  styleName: string;
  /** Against the record standing when it finished (`gapWhenFinished`); null for none. */
  gap: number | null;
}) {
  const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
  const speed = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

  return (
    <div className="flex flex-col gap-3">
      {run.invalidated ? (
        <p className="text-text-muted text-sm">
          This run was invalidated and isn&apos;t on the leaderboards.
        </p>
      ) : (
        !run.personal_best && (
          <p className="text-text-muted text-sm">
            A faster run has replaced this one as {run.player.name}&apos;s
            personal best.
          </p>
        )
      )}
      {/* The first and last rows lose their outer padding, which the dialog or card around them already has. */}
      <DividedList as="dl" className="text-sm *:first:pt-0 *:last:pb-0">
        <Row term="Time">
          <span className="text-accent flex items-center justify-end gap-2 font-bold tabular-nums">
            {run.invalidated && <Badge tone="danger">Invalidated</Badge>}
            {run.rank === 1 && <Badge tone="accent">WR</Badge>}
            {formatTime(run.time)}
            {/* After the time, as on Activity and the run's page. */}
            {gap != null && (
              <RecordGap gap={gap} className="text-xs font-normal" />
            )}
          </span>
        </Row>
        <Row term="Place">
          {run.invalidated
            ? "Not on the leaderboard"
            : run.rank == null
              ? "Not a personal best"
              : ordinal(run.rank)}
        </Row>
        <Row term="Player">
          <Link
            href={`/players/${run.player.steamid64}`}
            className="hover:text-accent inline-flex items-center gap-2"
          >
            <Avatar
              name={run.player.name}
              src={avatarSrc(run.player)}
              size="sm"
            />
            <span className="inline-flex items-center gap-1.5">
              {run.player.name}
              <Flag code={run.player.country_code} />
            </span>
          </Link>
        </Row>
        <Row term="Map">
          <Link
            href={`/maps/${run.map}?style=${run.style}&track=${run.track}`}
            className="hover:text-accent"
          >
            {run.map}
          </Link>
        </Row>
        <Row term="Style, track">
          {styleName}, {trackName(run.track)}
        </Row>
        <Row term="Jumps / strafes">
          {run.jumps} / {run.strafes}
        </Row>
        <Row term="Sync / perfs">
          {number.format(run.sync)}% / {number.format(run.perfs)}%
        </Row>
        <Row term="Speed avg / max">
          {speed.format(run.avg_velocity)} / {speed.format(run.max_velocity)}{" "}
          u/s
        </Row>
        <Row term="Server">
          {run.server_name}, {speed.format(run.tickrate)} tick
        </Row>
        <Row term="Finished">
          <time dateTime={run.finished_at}>{formatDate(run.finished_at)}</time>
        </Row>
        <Row term="Ruleset">Version {run.ruleset_version}</Row>
      </DividedList>
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2">
      <dt className="text-text-muted shrink-0">{term}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

const ordinals = new Intl.PluralRules("en", { type: "ordinal" });
const suffixes: Record<string, string> = {
  one: "st",
  two: "nd",
  few: "rd",
  other: "th",
};

/** 1st, 2nd, 3rd, 4th, 11th, 21st… */
function ordinal(place: number): string {
  return `${place}${suffixes[ordinals.select(place)] ?? "th"}`;
}
