// One map in the Maps page's grid: its picture, tier, name and player count, then the main track's top three
// times and the signed-in player's own, each linking to its run. The picture and name open the map in the
// style those times are in.
import type { Schemas } from "@/api/client";
import { formatTime } from "@/features/runs/time";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { TierBadge } from "@/ui/TierBadge";
import { MapImage } from "./MapImage";

/** Every row is the same height, so tiles line up whether a map has one time or four. */
const ROW = "flex h-7 items-center gap-2 rounded-md px-1.5";

export function MapTile({
  map,
  href,
  tierCount,
  signInHref,
}: {
  map: Schemas["MapSummary"];
  /** The map's page, on the style the tile's times are in. */
  href: string;
  tierCount: number | null | undefined;
  /** Set when nobody is signed in: the "Your time" row offers sign-in instead. */
  signInHref?: string;
}) {
  const top = map.top ?? [];
  const mine = map.viewer_time;
  const detail = [
    map.players === 1 ? "1 player" : `${map.players} players`,
    map.bonuses > 0 &&
      (map.bonuses === 1 ? "1 bonus" : `${map.bonuses} bonuses`),
  ]
    .filter(Boolean)
    .join(" · ");
  // The tile isn't one link: its time rows link to runs, and a link can't hold other links. The picture and the
  // name lead to the map.
  return (
    // On hover the border brightens and the picture eases in a little: enough to show the tile is alive without
    // a lift, which would say the whole tile is one link.
    <article className="group border-border bg-surface hover:border-border-strong flex flex-col overflow-hidden rounded-lg border transition-colors duration-(--duration-base)">
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden
        className="relative block overflow-hidden"
      >
        <MapImage
          image={map.image}
          size="card"
          className="rounded-none border-0 transition-transform duration-(--duration-slow) ease-out motion-safe:group-hover:scale-103"
        />
        {map.tier != null && tierCount != null && (
          // A solid backing, shaped to the badge (flex, so no line height pads it): the badge's faint tint
          // alone is lost against a busy picture.
          <span className="bg-surface absolute bottom-2 left-2 flex rounded-sm">
            <TierBadge tier={map.tier} tierCount={tierCount} />
          </span>
        )}
      </Link>
      <div className="flex flex-col gap-2 p-2 pt-2.5">
        <div className="flex items-baseline gap-2 px-1.5">
          <Link
            href={href}
            className="hover:text-accent min-w-0 truncate font-bold"
          >
            {map.name}
          </Link>
          <span className="text-text-subtle ml-auto shrink-0 text-xs">
            {detail}
          </span>
        </div>
        <ol className="flex flex-col text-sm" aria-label="Fastest times">
          {top.map((entry, index) => (
            <li key={entry.run_id}>
              <Link
                href={`/runs/${entry.run_id}`}
                className={classNames(
                  ROW,
                  "text-text-muted hover:bg-surface-raised hover:text-text transition-colors duration-(--duration-fast)",
                )}
              >
                <Medal placement={entry.place} />
                <span
                  className={classNames(
                    "min-w-0 flex-1 truncate",
                    entry.player.steamid64 === mine?.player.steamid64 &&
                      "text-accent",
                  )}
                >
                  {entry.player.steamid64 === mine?.player.steamid64
                    ? "You"
                    : entry.player.name}
                </span>
                <span
                  className={classNames(
                    "font-bold tabular-nums",
                    index === 0 ? "text-accent" : "text-text",
                  )}
                >
                  {formatTime(entry.time)}
                </span>
              </Link>
            </li>
          ))}
          {top.length === 0 && (
            <li className={classNames(ROW, "text-text-subtle")}>
              No times in this style yet.
            </li>
          )}
        </ol>
        <div className="border-border mx-1.5 border-t" />
        <YourTime mine={mine} signInHref={signInHref} />
      </div>
    </article>
  );
}

/** The signed-in player's own best and place, or why there isn't one. */
function YourTime({
  mine,
  signInHref,
}: {
  mine: Schemas["PlacedTime"] | null | undefined;
  signInHref?: string;
}) {
  if (mine) {
    return (
      <Link
        href={`/runs/${mine.run_id}`}
        className={classNames(
          ROW,
          "hover:bg-surface-raised text-sm transition-colors duration-(--duration-fast)",
        )}
      >
        <span className="text-text-subtle w-6 shrink-0 text-center text-xs font-bold tabular-nums">
          #{mine.place}
        </span>
        <span className="flex-1">Your time</span>
        <span className="font-bold tabular-nums">{formatTime(mine.time)}</span>
      </Link>
    );
  }
  return (
    <div className={classNames(ROW, "text-text-subtle text-sm")}>
      <span className="w-6 shrink-0 text-center">–</span>
      <span className="flex-1">Your time</span>
      {signInHref ? (
        // A full page load: the API sends the player on to Steam.
        <a href={signInHref} className="text-text-muted hover:text-accent">
          Sign in
        </a>
      ) : (
        <span>Not finished</span>
      )}
    </div>
  );
}
