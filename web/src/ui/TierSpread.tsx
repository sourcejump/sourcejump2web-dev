// Map difficulty distribution and filters, sharing one aligned legend across screen sizes.
import { Check, RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";
import { TierBadge, tierColor } from "./TierBadge";

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en");
const RADIUS = 40;
const WIDTH = 16;
const GAP = 0.6;

// Filled sectors keep their angular boundaries when highlighted, unlike repeated stroke dashes.
function sector(start: number, length: number, width: number) {
  const outer = RADIUS + width / 2;
  const inner = RADIUS - width / 2;
  const point = (share: number, radius: number) => {
    const angle = (share / 100) * Math.PI * 2 - Math.PI / 2;
    return `${50 + radius * Math.cos(angle)} ${50 + radius * Math.sin(angle)}`;
  };
  if (length === 100) {
    return `M ${point(start, outer)} A ${outer} ${outer} 0 1 1 ${point(start + 50, outer)} A ${outer} ${outer} 0 1 1 ${point(start, outer)} L ${point(start, inner)} A ${inner} ${inner} 0 1 0 ${point(start + 50, inner)} A ${inner} ${inner} 0 1 0 ${point(start, inner)} Z`;
  }
  const gap = Math.min(GAP, length / 3);
  const from = start + gap / 2;
  const to = start + length - gap / 2;
  const large = to - from > 50 ? 1 : 0;
  return `M ${point(from, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(to, outer)} L ${point(to, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(from, inner)} Z`;
}

export function TierSpread({
  byTier,
  untiered,
  selected,
  tierHref,
}: {
  /** Maps per tier, tier 1 first; its length is the tier count. */
  byTier: number[];
  untiered: number;
  selected?: number;
  /** null returns to the complete list. */
  tierHref: (tier: number | null) => string;
}) {
  const total = byTier.reduce((sum, count) => sum + count, untiered);
  if (total === 0) return null;
  const tierCount = byTier.length;
  const slices = byTier.map((count, index) => ({
    tier: index + 1,
    count,
    start:
      (byTier.slice(0, index).reduce((sum, c) => sum + c, 0) / total) * 100,
    length: (count / total) * 100,
  }));
  const half = Math.ceil(tierCount / 2);
  const columns = [slices.slice(0, half), slices.slice(half)].filter(
    (tiers, index) => tiers.length > 0 || (index === 1 && untiered > 0),
  );
  const all = selected == null;
  const chosen = selected != null ? byTier[selected - 1] : undefined;
  const tieredShare = ((total - untiered) / total) * 100;

  return (
    <div
      role="group"
      aria-label="Maps by tier"
      className="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:gap-6"
    >
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Maps per tier, ${tierCount} tiers`}
        className="hidden size-40 shrink-0 sm:block"
      >
        <g>
          {untiered > 0 && (
            <path
              d={sector(tieredShare, (untiered / total) * 100, WIDTH)}
              className="fill-surface-raised"
            />
          )}
          {slices.map(
            ({ tier, count, start, length }) =>
              count > 0 && (
                <Link
                  key={tier}
                  href={tierHref(selected === tier ? null : tier)}
                  scroll={false}
                  tabIndex={-1}
                  style={
                    { "--tier": tierColor(tier, tierCount) } as CSSProperties
                  }
                  className={classNames(
                    "group/arc fill-(--tier) transition-opacity duration-(--duration-base) outline-none motion-reduce:transition-none",
                    !all && selected !== tier && "opacity-25",
                  )}
                  aria-label={`Tier ${tier}: ${number.format(count)} maps`}
                >
                  <title>{`Tier ${tier}: ${number.format(count)} maps`}</title>
                  <path d={sector(start, length, WIDTH)} />
                  <path
                    d={sector(start, length, 19)}
                    className={classNames(
                      "pointer-events-none transition-opacity duration-(--duration-base) group-hover/arc:opacity-100 motion-reduce:transition-none",
                      selected === tier ? "opacity-100" : "opacity-0",
                    )}
                  />
                </Link>
              ),
          )}
        </g>
        <text
          x="50"
          y={chosen != null ? 46 : 50}
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-text text-[12px] font-bold tabular-nums"
        >
          {all ? "All" : `T${selected}`}
        </text>
        {chosen != null && (
          <text
            x="50"
            y="60"
            textAnchor="middle"
            className="fill-text-muted text-[7px] tabular-nums"
          >
            {number.format(chosen)} {chosen === 1 ? "map" : "maps"}
          </text>
        )}
      </svg>

      <nav
        aria-label="Filter maps by tier"
        className="flex w-fit max-w-full flex-col gap-2"
      >
        <div
          aria-hidden
          className="bg-border-strong flex h-1.5 gap-px overflow-hidden rounded-full sm:hidden"
        >
          {slices.map(
            ({ tier, count }) =>
              count > 0 && (
                <span
                  key={tier}
                  style={{
                    backgroundColor: tierColor(tier, tierCount),
                    flex: count,
                  }}
                  className={classNames(
                    "transition-opacity duration-(--duration-fast)",
                    !all && selected !== tier && "opacity-30",
                  )}
                />
              ),
          )}
          {untiered > 0 && <span style={{ flex: untiered }} />}
        </div>
        <Link
          href={tierHref(null)}
          scroll={false}
          aria-current={all ? "true" : undefined}
          className={classNames(
            "flex h-8 items-center justify-between gap-3 rounded-sm px-2 text-sm ring-1 transition-colors duration-(--duration-fast) ring-inset",
            all
              ? "bg-surface-raised text-text ring-border-strong hover:bg-surface-overlay"
              : "text-text-muted ring-border hover:bg-surface-raised hover:text-text hover:ring-border-strong",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            {all ? (
              <Check aria-hidden className="text-accent size-3.5" />
            ) : (
              <RotateCcw aria-hidden className="size-3.5" />
            )}
            All tiers
          </span>
          <span className="text-text-muted text-xs tabular-nums">
            {number.format(total)} maps
          </span>
        </Link>
        {/* Intrinsic columns keep counts close to badges. With no row padding, the reset's edges
            coincide with the first badge and the last percentage, including its selected background. */}
        <div
          className={classNames(
            "grid items-start gap-x-5",
            columns.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {columns.map((tiers, index) => (
            <ul
              key={index}
              className="grid auto-rows-[1.5rem] grid-cols-[2rem_minmax(2ch,1fr)_4ch] gap-x-2 gap-y-1 text-sm"
            >
              {tiers.map(({ tier, count }) => {
                const active = selected === tier;
                return (
                  <li key={tier} className="col-span-3 grid grid-cols-subgrid">
                    <Link
                      href={tierHref(active ? null : tier)}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      aria-label={`Tier ${tier}: ${number.format(count)} maps, ${percent.format(count / total)}`}
                      style={
                        {
                          "--tier": tierColor(tier, tierCount),
                        } as CSSProperties
                      }
                      className={classNames(
                        "group relative isolate col-span-3 grid grid-cols-subgrid items-center rounded-sm before:pointer-events-none before:absolute before:inset-y-0 before:-right-1 before:left-0 before:-z-10 before:rounded-sm before:transition-colors before:duration-(--duration-fast)",
                        active
                          ? "before:bg-(--tier)/15 before:ring-1 before:ring-[color:color-mix(in_oklch,var(--tier)_70%,var(--color-text))] before:ring-inset"
                          : "hover:before:bg-text/4",
                      )}
                    >
                      <TierBadge
                        tier={tier}
                        tierCount={tierCount}
                        className="group-aria-[current=true]:text-text w-8"
                      />
                      <span className="text-text text-right font-bold tabular-nums">
                        {number.format(count)}
                      </span>
                      <span
                        className={classNames(
                          "text-right tabular-nums",
                          active
                            ? "text-[color:color-mix(in_oklch,var(--tier)_70%,var(--color-text))]"
                            : "text-text-muted group-hover:text-text",
                        )}
                      >
                        {percent.format(count / total)}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {index === columns.length - 1 && untiered > 0 && (
                <li className="text-text-muted col-span-3 grid grid-cols-subgrid items-center">
                  <span className="text-xs whitespace-nowrap">No tier</span>
                  <span className="text-right tabular-nums">
                    {number.format(untiered)}
                  </span>
                  <span className="text-text-muted text-right tabular-nums">
                    {percent.format(untiered / total)}
                  </span>
                </li>
              )}
            </ul>
          ))}
        </div>
      </nav>
    </div>
  );
}
