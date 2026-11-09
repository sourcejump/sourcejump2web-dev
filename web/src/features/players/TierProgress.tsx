// A player's completed maps per tier, as bars: the filled part links to the maps of that tier they've finished
// on the Maps page, the rest to the ones still to do, each with a hint saying which.
import type { CSSProperties } from "react";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";
import { TierBadge } from "@/ui/TierBadge";
import { Tooltip } from "@/ui/Tooltip";

const number = new Intl.NumberFormat("en");

export function TierProgress({
  completed,
  totals,
  styleName,
  href,
}: {
  /** Maps finished per tier, tier 1 first. */
  completed: number[];
  /** Maps on the list per tier, tier 1 first; its length is the tier count. */
  totals: number[];
  /** "Normal", or "any style". */
  styleName: string;
  /** The Maps page for one tier, finished or not. */
  href: (tier: number, finished: boolean) => string;
}) {
  const tierCount = totals.length;
  return (
    <ul className="flex flex-1 flex-col justify-between gap-0.5">
      {totals.map((total, index) => {
        const tier = index + 1;
        const done = Math.min(completed[index] ?? 0, total);
        const left = total - done;
        return (
          <li key={tier} className="flex items-center gap-3">
            <span className="w-8 shrink-0">
              <TierBadge tier={tier} tierCount={tierCount} />
            </span>
            {total === 0 ? (
              <span className="bg-surface-raised h-2 flex-1 rounded-sm" />
            ) : (
              <span className="flex h-6 min-w-0 flex-1">
                {done > 0 && (
                  <Segment
                    share={done / total}
                    href={href(tier, true)}
                    hint={`${number.format(done)} tier ${tier} ${maps(done)} finished in ${styleName}`}
                    className={classNames(
                      "bg-accent hover:bg-accent-hover rounded-l-sm",
                      left === 0 && "rounded-r-sm",
                    )}
                  />
                )}
                {left > 0 && (
                  <Segment
                    share={left / total}
                    href={href(tier, false)}
                    hint={`${number.format(left)} tier ${tier} ${maps(left)} not finished yet in ${styleName}`}
                    className={classNames(
                      "bg-border hover:bg-border-strong rounded-r-sm",
                      done === 0 && "rounded-l-sm",
                    )}
                  />
                )}
              </span>
            )}
            <span className="w-24 shrink-0 text-right text-sm tabular-nums">
              {number.format(done)}{" "}
              <span className="text-text-muted">of {number.format(total)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function maps(count: number): string {
  return count === 1 ? "map" : "maps";
}

/** One part of a bar. The link is the row's full height, so it's easy to hit; its color fills the middle. */
function Segment({
  share,
  href,
  hint,
  className,
}: {
  share: number;
  href: string;
  hint: string;
  className: string;
}) {
  return (
    <Tooltip
      content={
        <>
          {hint}
          <span className="text-text-muted block">Opens on the Maps page</span>
        </>
      }
      className="min-w-1"
      style={{ width: `${share * 100}%` } as CSSProperties}
    >
      <Link
        href={href}
        aria-label={hint}
        className={classNames(
          "block w-full bg-clip-content py-2 transition-colors duration-(--duration-fast)",
          className,
        )}
      />
    </Tooltip>
  );
}
