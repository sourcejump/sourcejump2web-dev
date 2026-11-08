// Map difficulty filters with matching controls for all tiers and individual tiers.
import { classNames } from "./classNames";
import { Link } from "./Link";
import { TierBadge } from "./TierBadge";

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
  return (
    <section aria-label="Maps by tier" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-bold">Difficulty</h2>
      <div className="flex flex-col gap-1">
        <Link
          href={tierHref(null)}
          scroll={false}
          aria-current={selected == null ? "true" : undefined}
          className={classNames(
            "flex h-7 items-center justify-between rounded-sm px-2 text-sm transition-colors duration-(--duration-fast)",
            selected == null
              ? "bg-text/8 text-text"
              : "text-text-muted hover:text-accent",
          )}
        >
          <span>All tiers</span>
          <span className="text-text-muted text-xs tabular-nums">
            {number.format(total)}
          </span>
        </Link>
        <ul
          className="grid grid-flow-col grid-cols-2 gap-x-4 gap-y-1"
          style={{
            gridTemplateRows: `repeat(${Math.ceil(tierCount / 2)}, minmax(0, 1fr))`,
          }}
        >
          {byTier.map((count, index) => {
            const tier = index + 1;
            const active = tier === selected;
            return (
              <li key={tier} className="min-w-0">
                <Link
                  href={tierHref(tier)}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  aria-label={`Tier ${tier}: ${number.format(count)} maps`}
                  className={classNames(
                    "group flex h-6 items-center justify-between rounded-sm px-2 transition-colors duration-(--duration-fast)",
                    active && "bg-text/8",
                  )}
                >
                  <TierBadge tier={tier} tierCount={tierCount} />
                  <span className="text-text-muted group-hover:text-accent text-xs tabular-nums transition-colors duration-(--duration-fast)">
                    {number.format(count)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {untiered > 0 && (
        <p className="text-text-subtle text-xs">
          {number.format(untiered)} without a tier
        </p>
      )}
    </section>
  );
}
