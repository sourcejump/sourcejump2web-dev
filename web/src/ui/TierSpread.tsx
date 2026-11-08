// Tier distribution and filters, with one responsive layout for every screen size.
import type { CSSProperties } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";
import { TierBadge, tierColor } from "./TierBadge";

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
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-bold">Difficulty</h2>
        <Link
          href={tierHref(null)}
          scroll={false}
          aria-current={selected == null ? "true" : undefined}
          className="text-text-muted hover:text-accent rounded-sm text-xs"
        >
          All tiers{" "}
          <span className="ml-1 tabular-nums">{number.format(total)}</span>
        </Link>
      </div>
      <div
        aria-hidden
        className="bg-surface-raised flex h-1.5 gap-px overflow-hidden rounded-sm"
      >
        {byTier.map(
          (count, index) =>
            count > 0 && (
              <span
                key={index}
                style={{
                  backgroundColor: tierColor(index + 1, tierCount),
                  flex: count,
                }}
                className={classNames(
                  "transition-opacity duration-(--duration-fast)",
                  selected != null && selected !== index + 1 && "opacity-25",
                )}
              />
            ),
        )}
        {untiered > 0 && <span style={{ flex: untiered }} />}
      </div>
      <ul className="grid grid-cols-5 gap-2">
        {byTier.map((count, index) => {
          const tier = index + 1;
          const active = selected === tier;
          return (
            <li key={tier} className="min-w-0">
              <Link
                href={tierHref(active ? null : tier)}
                scroll={false}
                aria-current={active ? "true" : undefined}
                aria-label={`Tier ${tier}: ${number.format(count)} maps`}
                style={
                  { "--tier": tierColor(tier, tierCount) } as CSSProperties
                }
                className={classNames(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-sm border py-2 transition-colors duration-(--duration-fast)",
                  active
                    ? "border-(--tier)/50 bg-(--tier)/10"
                    : "bg-text/4 hover:border-border-strong hover:bg-text/8 border-transparent",
                  selected != null && !active && "opacity-50 hover:opacity-100",
                )}
              >
                <TierBadge
                  tier={tier}
                  tierCount={tierCount}
                  className="self-auto"
                />
                <span className="text-text-muted text-xs tabular-nums">
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
