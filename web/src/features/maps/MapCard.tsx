// A map preview with its main-track top three; names wrap and numeric columns stay aligned.
import type { Schemas } from "@/api/client";
import { avatarSrc } from "@/features/players/avatarSrc";
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
}: {
  map: Schemas["MapSummary"];
  tierCount: number | null | undefined;
  leaders: readonly MapLeader[] | null;
  styleName: string;
  styleKey?: string;
}) {
  const entries =
    leaders ?? (map.world_record ? [{ ...map.world_record, rank: 1 }] : []);
  const record = entries[0];
  const fastest = record?.time ?? 0;

  return (
    <Link
      href={`/maps/${map.name}${styleKey ? `?style=${encodeURIComponent(styleKey)}` : ""}`}
      data-map={map.name}
      className="border-border bg-surface group hover:border-border-strong @container/map-card relative flex h-full min-w-0 flex-col overflow-hidden rounded-md border transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
    >
      <div
        aria-hidden
        className={classNames(
          "pointer-events-none absolute inset-px overflow-hidden brightness-75",
          styles.picture,
        )}
      >
        <MapImage image={map.image} size="card" />
      </div>
      <div className="text-shadow-over-image relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 pb-3">
        <div className="flex max-w-full min-w-0 items-start gap-2">
          {map.tier != null && tierCount != null && (
            <span className="bg-gutter/90 mt-0.5 inline-flex shrink-0 rounded-sm">
              <TierBadge tier={map.tier} tierCount={tierCount} />
            </span>
          )}
          <h3 className="group-hover:text-accent min-w-0 text-base font-bold wrap-anywhere transition-colors duration-(--duration-fast) @md/map-card:text-lg">
            {map.name}
          </h3>
        </div>
        <p className="text-text-muted flex flex-wrap gap-x-3 text-xs">
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
      <div className="relative mt-auto">
        <ol
          aria-label={`Top 3 in ${styleName}`}
          className={classNames(
            "relative mr-4 mb-4 ml-auto grid w-fit max-w-full gap-x-2 gap-y-1",
            styles.podium,
          )}
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
              <span className={classNames("flex self-center", styles.avatar)}>
                <Avatar
                  name={entry.player.name}
                  src={avatarSrc(entry.player)}
                  size="sm"
                />
              </span>
              <span
                className={classNames(
                  "text-shadow-over-image min-w-0 self-end text-sm font-bold wrap-anywhere @md/map-card:text-base",
                  styles.player,
                )}
              >
                {entry.player.name}
              </span>
              <span
                className={classNames(
                  "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-start",
                  styles.result,
                )}
              >
                <span className="text-sm font-bold whitespace-nowrap tabular-nums @md/map-card:text-base">
                  {formatTime(entry.time)}
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
            <li className="text-text-muted text-shadow-over-image col-span-full flex items-center text-sm">
              No times in this style
            </li>
          )}
          {entries.length > 0 && entries.length < 3 && (
            <li className="text-text-muted text-shadow-over-image col-span-full flex items-end pb-1 text-xs">
              {leaders == null
                ? "Top 3 couldn't be loaded"
                : `${entries.length} ${entries.length === 1 ? "ranked time" : "ranked times"} in this style`}
            </li>
          )}
        </ol>
      </div>
    </Link>
  );
}
