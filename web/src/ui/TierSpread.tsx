// Map difficulty filters with matching controls for all tiers and individual tiers.
import type { CSSProperties } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";
import { tierColor } from "./TierBadge";

const number = new Intl.NumberFormat("en");

export function TierSpread({
  byTier,
  untiered,
  selected,
  tierHref,
}: {
  /** Map counts in tier order, easiest first. */
  byTier: number[];
  /** Maps which have no tier assigned. */
  untiered: number;
  /** The selected tier, if the map list is filtered. */
  selected?: number;
  /** Where a tier tile should link. Null returns to the complete list. */
  tierHref: (tier: number | null) => string;
}) {
  const total = byTier.reduce((sum, count) => sum + count, untiered);
  if (total === 0) return null;
  const tierCount = byTier.length;
  const choices = [
    { tier: null, count: total },
    ...byTier.map((count, index) => ({ tier: index + 1, count })),
  ];

  return (
    <section aria-label="Maps by tier" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-bold">Difficulty</h2>
      <ul className="flex flex-wrap gap-2">
        {choices.map(({ tier, count }) => {
          const active = tier === (selected ?? null);
          return (
            <li key={tier ?? "all"} className="min-w-0">
              <Link
                href={tierHref(tier)}
                scroll={false}
                aria-current={active ? "true" : undefined}
                aria-label={`${tier == null ? "All tiers" : `Tier ${tier}`}: ${number.format(count)} maps`}
                style={
                  tier == null
                    ? undefined
                    : ({
                        "--tier": tierColor(tier, tierCount),
                      } as CSSProperties)
                }
                className={classNames(
                  "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors duration-(--duration-fast)",
                  active
                    ? "border-accent/50 bg-accent-soft text-accent"
                    : "border-border-strong text-text-muted hover:bg-text/4 hover:text-text",
                )}
              >
                <span
                  className={classNames(
                    "font-medium",
                    tier != null && !active && "text-(color:--tier)",
                  )}
                >
                  {tier == null ? "All tiers" : `T${tier}`}
                </span>
                <span
                  className={classNames(
                    "text-xs tabular-nums",
                    active ? "text-accent" : "text-text-subtle",
                  )}
                >
                  {number.format(count)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {untiered > 0 && (
        <p className="text-text-subtle text-xs">
          {number.format(untiered)} without a tier
        </p>
      )}
    </section>
  );
}
