// A list of players as the Players page shows them: two columns on wider screens, reading down each, a line
// between rows and between the columns. Each row is the player, their flag if they have one, and how long ago
// they last finished a run, in the accent within the hour. Rendered on the server for the first view and in
// the browser for searches as they're typed, so it holds no state of its own.
import type { CSSProperties } from "react";
import type { Schemas } from "@/api/client";
import { formatDate, formatSince } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { avatarSrc } from "@/features/players/avatarSrc";

/**
 * Players asked for per search, so a full answer can say there may be more. Here, in a module both sides import,
 * as a client module's exports reach server code only as references.
 */
export const SEARCH_LIMIT = 20;

export function PlayerRows({
  players,
  now,
  animate = true,
}: {
  players: Schemas["PlayerSummary"][];
  /** One moment for every row's "ago". */
  now: Date;
  /** Off for results that change as someone types: they should land at once, not fade in. */
  animate?: boolean;
}) {
  const half = Math.ceil(players.length / 2);
  return (
    <ul
      className="sm:grid sm:grid-flow-col sm:grid-cols-2"
      // Rows fill the left column first, so the list reads top to bottom like the order it's in.
      style={{ gridTemplateRows: `repeat(${half}, auto)` }}
    >
      {players.map((player, index) => (
        <li
          key={player.steamid64}
          className={classNames(
            "border-border border-t",
            index < half && "sm:border-r",
            animate && "motion-enter",
          )}
          style={
            animate
              ? ({
                  "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                } as CSSProperties)
              : undefined
          }
        >
          <Link
            href={`/players/${player.steamid64}`}
            className="group hover:bg-surface-raised flex h-14 items-center gap-3 px-5 transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
          >
            <Avatar name={player.name} src={avatarSrc(player)} />
            {/* Most players have no country on Steam; a column of placeholders would only be noise. */}
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="group-hover:text-accent min-w-0 truncate transition-colors duration-(--duration-fast)">
                {player.name}
              </span>
              {player.country_code && <Flag code={player.country_code} />}
            </span>
            <span className="ml-auto shrink-0 pl-2 text-right text-xs tabular-nums">
              {player.last_run_at ? (
                <time
                  dateTime={player.last_run_at}
                  title={formatDate(player.last_run_at)}
                  className={
                    now.getTime() - Date.parse(player.last_run_at) < 60 * 60_000
                      ? "text-accent"
                      : "text-text-muted"
                  }
                >
                  {formatSince(player.last_run_at, now)}
                </time>
              ) : (
                // Search finds players with no 2.0 runs too.
                <span className="text-text-subtle">No 2.0 runs</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
