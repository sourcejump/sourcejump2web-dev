// Map details overlay the preview; records and the signed-in player's PB sit plainly below it.
import type { Schemas } from "@/api/client";
import { avatarSrc } from "@/features/players/avatarSrc";
import { ReplayLink } from "@/features/replays/ReplayLink";
import { RunLink } from "@/features/runs/RunLink";
import { formatGap, formatTime } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { TierBadge } from "@/ui/TierBadge";
import { MapImage } from "./MapImage";
import type { MapLeader } from "./mapPodiums";
import styles from "./MapCard.module.css";

const number = new Intl.NumberFormat("en");

export function MapCard({
  map,
  tierCount,
  leaders,
  styleName,
  styleKey,
  showPersonalBest = false,
  personalBest,
}: {
  map: Schemas["MapSummary"];
  tierCount: number | null | undefined;
  leaders: readonly MapLeader[] | null;
  styleName: string;
  styleKey?: string;
  showPersonalBest?: boolean;
  personalBest?: MapLeader | null;
}) {
  const entries =
    leaders ?? (map.world_record ? [{ ...map.world_record, rank: 1 }] : []);
  const record = entries[0];
  const fastest = record?.time ?? 0;

  return (
    <article
      data-map={map.name}
      className="border-border hover:border-accent/40 focus-within:border-accent/60 @container/map-card relative flex h-full min-w-0 flex-col overflow-hidden rounded-md border transition-colors duration-(--duration-fast)"
    >
      <div
        className={classNames(
          "group/cover relative flex flex-col justify-end overflow-hidden",
          styles.cover,
        )}
      >
        <MapImage
          image={map.image}
          size="card"
          className={classNames(
            styles.preview,
            "absolute inset-0 h-full group-hover/cover:brightness-110",
          )}
        />
        <div className="text-shadow-over-image z-10 mt-auto min-w-0 p-3">
          <div className="flex min-w-0 items-start gap-2">
            {map.tier != null && tierCount != null && (
              <span className="mt-0.5 inline-flex shrink-0">
                <TierBadge tier={map.tier} tierCount={tierCount} />
              </span>
            )}
            <h3 className="group-hover/cover:text-accent min-w-0 text-base font-bold wrap-anywhere transition-colors duration-(--duration-fast)">
              <Link
                href={`/maps/${map.name}${styleKey ? `?style=${encodeURIComponent(styleKey)}` : ""}`}
                className="focus-visible:after:outline-accent after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2"
              >
                {map.name}
              </Link>
            </h3>
          </div>
          <p className="text-text mt-1 flex flex-wrap gap-x-3 text-xs">
            <span>
              {number.format(map.players)}{" "}
              {map.players === 1 ? "player" : "players"}
            </span>
            {map.bonuses > 0 && (
              <span>
                {number.format(map.bonuses)}{" "}
                {map.bonuses === 1 ? "bonus" : "bonuses"}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="border-border flex min-w-0 flex-1 flex-col border-t p-3">
        <ol
          aria-label={`Top 3 in ${styleName}`}
          className={classNames("grid w-full gap-x-2 gap-y-1", styles.podium)}
        >
          {entries.map((entry) => (
            <li
              key={entry.run_id}
              className={classNames(
                "grid items-center gap-y-0.5",
                styles.entry,
              )}
            >
              <span className={classNames("flex self-center", styles.rank)}>
                <Medal placement={entry.rank} />
              </span>
              <Link
                href={`/players/${entry.player.steamid64}`}
                className={classNames(
                  "group/player hover:text-accent relative z-10 grid min-w-0 items-center gap-x-2 rounded-sm text-sm font-bold underline-offset-4",
                  styles.playerLink,
                )}
              >
                <span className={classNames("flex", styles.avatar)}>
                  <Avatar
                    name={entry.player.name}
                    src={avatarSrc(entry.player)}
                    size="sm"
                  />
                </span>
                <span
                  className={classNames(
                    "min-w-0 wrap-anywhere group-hover/player:underline",
                    styles.player,
                  )}
                >
                  {entry.player.name}
                </span>
              </Link>
              <span
                className={classNames(
                  "relative z-10 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-start",
                  styles.result,
                )}
              >
                <span className="inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap tabular-nums">
                  <RunLink
                    runId={entry.run_id}
                    className="hover:text-accent rounded-sm underline-offset-4 hover:underline"
                  >
                    {formatTime(entry.time)}
                  </RunLink>
                  <ReplayLink runId={entry.run_id} />
                </span>
                {entry.run_id === record?.run_id ? (
                  <Badge
                    tone="accent"
                    aria-label="World record"
                    className="justify-self-end"
                  >
                    WR
                  </Badge>
                ) : (
                  <span className="text-danger text-right text-xs whitespace-nowrap tabular-nums">
                    {formatGap(entry.time - fastest)}
                  </span>
                )}
              </span>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="text-text-muted col-span-full flex items-center text-sm">
              {leaders === null
                ? "Times couldn't be loaded"
                : "No times in this style"}
            </li>
          )}
        </ol>
        {showPersonalBest && (
          <div
            role="group"
            aria-label="Your personal best"
            className="border-border relative z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs tabular-nums"
          >
            <span className="text-text-muted">Your PB</span>
            {personalBest ? (
              <>
                <span className="text-accent font-bold">
                  #{number.format(personalBest.rank)}
                </span>
                <span className="inline-flex flex-wrap items-center gap-x-1.5">
                  <RunLink
                    runId={personalBest.run_id}
                    className="hover:text-accent rounded-sm text-sm font-bold underline-offset-4 hover:underline"
                  >
                    {formatTime(personalBest.time)}
                  </RunLink>
                  {personalBest.time > fastest && fastest > 0 ? (
                    <span className="text-danger">
                      ({formatGap(personalBest.time - fastest)})
                    </span>
                  ) : fastest > 0 ? (
                    <Badge tone="accent">
                      {personalBest.run_id === record?.run_id ? "WR" : "WR tie"}
                    </Badge>
                  ) : null}
                </span>
              </>
            ) : (
              <span className="text-text-muted">
                {personalBest === null ? "Not completed" : "Couldn't load PB"}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
