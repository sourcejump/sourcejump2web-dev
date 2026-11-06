// What the old site kept of a pre-2.0 run, laid out like a 2.0 run's details: the run dialog's content for runs
// opened from a board's Pre-2.0 view or its record history.
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import {
  formatDate,
  formatGap,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { DividedList } from "@/ui/Divided";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { LegacyBadge } from "./LegacyBadge";

export function LegacyRunDetailList({
  run,
  styleName,
}: {
  run: Schemas["LegacyRunDetail"];
  styleName: string;
}) {
  const gap = run.time - run.record_time;
  const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-muted text-sm">
        Set on the old site, before SourceJump 2.0. It doesn&apos;t count toward
        2.0 records, and the old site kept no more than this.
      </p>
      {/* The first and last rows lose their outer padding, which the dialog around them already has. */}
      <DividedList as="dl" className="text-sm *:first:pt-0 *:last:pb-0">
        <Row term="Time">
          <span className="text-accent flex items-center justify-end gap-2 font-bold tabular-nums">
            <LegacyBadge />
            {/* Behind the pre-2.0 record, put before the time as for 2.0 runs. */}
            {gap > 0 && (
              <span className="text-danger text-xs font-normal">
                {formatGap(gap)}
              </span>
            )}
            {formatTime(run.time)}
          </span>
        </Row>
        <Row term="Player">
          <Link
            href={`/players/${run.player.steamid64}`}
            className="hover:text-accent inline-flex items-center gap-2"
          >
            <Avatar
              name={run.player.name}
              src={run.player.avatar_url ?? undefined}
              size="sm"
            />
            {run.player.name}
            <Flag code={run.player.country_code} />
          </Link>
        </Row>
        {run.player_name !== run.player.name && (
          <Row term="Played as">{run.player_name}</Row>
        )}
        <Row term="Map">
          <Link
            href={`/maps/${run.map}?view=legacy`}
            className="hover:text-accent"
          >
            {run.map}
          </Link>
        </Row>
        <Row term="Style, track">
          {styleName}, {trackName(0)}
        </Row>
        <Row term="Jumps / strafes">
          {run.jumps} / {run.strafes}
        </Row>
        <Row term="Sync">{number.format(run.sync)}%</Row>
        <Row term="Server">{run.server_name}</Row>
        <Row term="Finished">
          {run.finished_at ? (
            <time dateTime={run.finished_at}>
              {formatDate(run.finished_at)}
            </time>
          ) : (
            "Unknown"
          )}
        </Row>
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
