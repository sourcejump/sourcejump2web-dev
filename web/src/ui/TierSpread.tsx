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
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-bold">Difficulty</h2>
        <span className="text-text-subtle text-xs tabular-nums">
          {number.format(total)} maps
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-3">
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
                  "flex h-9 items-center justify-between gap-2 border-b-2 px-1 text-sm transition-colors duration-(--duration-fast)",
                  active
                    ? "border-text text-text"
                    : "text-text-muted hover:border-text-subtle hover:text-text border-transparent",
                )}
              >
                <span
                  className={classNames(
                    "font-medium",
                    tier != null && "text-(color:--tier)",
                  )}
                >
                  {tier == null ? "All tiers" : `T${tier}`}
                </span>
                <span className="text-text-subtle text-xs tabular-nums">
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
