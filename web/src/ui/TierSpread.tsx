// How many maps hold each tier: a donut split by tier, each slice in its tier's color, beside each tier's count and
// share. Every slice and row links to the maps of that tier; the chosen tier stays bright and the others dim.
// Maps without a tier fill the donut's end in a neutral color. On a phone, where the donut and its list stood
// nearly a screen tall, it's a bar split by tier and the tiers as a grid of small tiles instead.
import type { CSSProperties } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";
import { TierBadge, tierColor } from "./TierBadge";

/** Each tier's share of all maps, so the shares (with "No tier") add up to the whole list. */
const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en");

/** The ring's radius and width, in the SVG's 100-unit box. */
const RADIUS = 40;
const WIDTH = 16;
/** Space between slices, in hundredths of the ring. */
const GAP = 0.6;

/** The reset uses the site accent; individual selections use their tier color. */
const allTiersClasses = (chosen: boolean) =>
  classNames(
    "flex h-7 w-full items-center justify-between gap-2 rounded-sm border px-2 text-sm font-medium transition-colors duration-(--duration-fast)",
    chosen
      ? "border-accent/40 bg-accent-soft text-accent hover:border-accent"
      : "border-border-strong text-text-muted hover:border-text-muted hover:bg-text/4 hover:text-text",
  );

const rowClasses =
  "col-span-3 grid grid-cols-subgrid items-center rounded-sm px-2 py-0.5 ring-1 ring-inset transition-[background-color,box-shadow] duration-(--duration-fast)";

/** The inset outline marks selection without moving the compact rows. */
const chosenTier = "bg-(--tier)/10 ring-(--tier)/40";

export function TierSpread({
  byTier,
  untiered,
  selected,
  tierHref,
}: {
  /** Maps per tier, tier 1 first; its length is the tier count. */
  byTier: number[];
  untiered: number;
  /** The tier the list is filtered to, if any. */
  selected?: number;
  /** Where a tier leads; null for the whole list. */
  tierHref: (tier: number | null) => string;
}) {
  const total = byTier.reduce((sum, count) => sum + count, untiered);
  if (total === 0) return null;
  const tierCount = byTier.length;
  const dimmed = (tier: number) => selected != null && selected !== tier;

  // Each slice is a dashed stroke around the ring: as long as its share, starting where the last one ended.
  // Strokes rather than wedge paths, so a slice is one circle and grows its width on hover.
  const slices = byTier.map((count, index) => ({
    tier: index + 1,
    count,
    start:
      (byTier.slice(0, index).reduce((sum, c) => sum + c, 0) / total) * 100,
    length: (count / total) * 100,
  }));
  const tieredShare = (byTier.reduce((sum, c) => sum + c, 0) / total) * 100;
  const chosen = selected != null ? byTier[selected - 1] : undefined;
  const half = Math.ceil(tierCount / 2);
  // The first column holds the lower half; the second the rest and "No tier" after them.
  const rows = Math.max(half, tierCount - half + (untiered > 0 ? 1 : 0));
  const tierRow = ({ tier, count }: (typeof slices)[number]) => (
    <li key={tier} className="col-span-3 grid grid-cols-subgrid">
      <Link
        href={tierHref(selected === tier ? null : tier)}
        scroll={false}
        aria-current={selected === tier ? "true" : undefined}
        style={{ "--tier": tierColor(tier, tierCount) } as CSSProperties}
        className={classNames(
          rowClasses,
          selected === tier
            ? chosenTier
            : "hover:bg-text/4 hover:ring-border-strong ring-transparent",
        )}
      >
        <TierBadge tier={tier} tierCount={tierCount} />
        <span className="text-right tabular-nums">{number.format(count)}</span>
        <span className="text-text-subtle tabular-nums">
          {percent.format(count / total)}
        </span>
      </Link>
    </li>
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:hidden">
        {/* The donut's shares laid end to end. */}
        <div
          aria-hidden
          className="bg-surface-raised flex h-2 gap-px overflow-hidden rounded-full"
        >
          {slices.map(
            ({ tier, count }) =>
              count > 0 && (
                <span
                  key={tier}
                  style={
                    {
                      "--tier": tierColor(tier, tierCount),
                      flexGrow: count,
                    } as CSSProperties
                  }
                  className={classNames(
                    "bg-(--tier) transition-opacity duration-(--duration-base)",
                    dimmed(tier) && "opacity-25",
                  )}
                />
              ),
          )}
          {untiered > 0 && <span style={{ flexGrow: untiered }} />}
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <Link
            href={tierHref(null)}
            scroll={false}
            aria-current={selected == null ? "true" : undefined}
            className={allTiersClasses(selected == null)}
          >
            All tiers
            <span className="text-text-subtle text-xs font-normal tabular-nums">
              {number.format(total)} maps
            </span>
          </Link>
          {untiered > 0 && (
            <span className="text-text-muted text-xs tabular-nums">
              {number.format(untiered)} without a tier
            </span>
          )}
        </div>
        <ul className="grid grid-cols-5 gap-1.5">
          {slices.map(({ tier, count }) => (
            <li key={tier}>
              <Link
                href={tierHref(selected === tier ? null : tier)}
                scroll={false}
                aria-current={selected === tier ? "true" : undefined}
                aria-label={`Tier ${tier}: ${number.format(count)} maps`}
                style={
                  { "--tier": tierColor(tier, tierCount) } as CSSProperties
                }
                className={classNames(
                  "flex flex-col items-center gap-1 rounded-md border py-1.5 transition-[opacity,background-color] duration-(--duration-base)",
                  selected === tier
                    ? "border-(--tier)/50 bg-(--tier)/15"
                    : "border-border-strong hover:bg-text/4 hover:border-(--tier)/40",
                )}
              >
                <TierBadge tier={tier} tierCount={tierCount} />
                <span className="text-xs tabular-nums">
                  {number.format(count)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden min-w-0 flex-col items-center gap-4 sm:flex sm:flex-row sm:items-center sm:gap-6">
        <svg
          viewBox="0 0 100 100"
          className="size-36 shrink-0 -rotate-90"
          role="img"
          aria-label={`Maps per tier, ${tierCount} tiers`}
        >
          {untiered > 0 && (
            <circle
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              pathLength={100}
              strokeWidth={WIDTH}
              className="stroke-surface-raised"
              strokeDasharray={`${Math.max((untiered / total) * 100 - GAP, 0)} 100`}
              strokeDashoffset={-tieredShare}
            />
          )}
          {slices.map(
            ({ tier, count, start, length }) =>
              count > 0 && (
                <Link
                  key={tier}
                  href={tierHref(selected === tier ? null : tier)}
                  scroll={false}
                  aria-label={`Tier ${tier}: ${number.format(count)} maps`}
                >
                  <title>{`Tier ${tier}: ${number.format(count)} maps`}</title>
                  <circle
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    fill="none"
                    pathLength={100}
                    strokeWidth={WIDTH}
                    // Very small tiers still show as a sliver rather than vanishing into the gap.
                    strokeDasharray={`${Math.max(length - GAP, 0.3)} 100`}
                    strokeDashoffset={-start}
                    style={
                      { "--tier": tierColor(tier, tierCount) } as CSSProperties
                    }
                    className={classNames(
                      "stroke-(--tier) transition-[opacity,stroke-width] duration-(--duration-base) hover:stroke-[19]",
                      dimmed(tier) && "opacity-25",
                      selected === tier && "stroke-[19]",
                    )}
                  />
                </Link>
              ),
          )}
          {/* Counter-rotated, so the middle reads upright inside the turned ring. */}
          <g className="[transform-origin:50px_50px] rotate-90">
            <text
              x="50"
              y={chosen != null ? 48 : 54}
              textAnchor="middle"
              className="fill-text text-[13px] font-bold tabular-nums"
            >
              {selected != null ? `T${selected}` : "All"}
            </text>
            {chosen != null && (
              <text
                x="50"
                y="61"
                textAnchor="middle"
                className="fill-text-muted text-[8px] tabular-nums"
              >
                {number.format(chosen)} maps
              </text>
            )}
          </g>
        </svg>

        {/* "All tiers", always there to go back to, centered over the two columns it sums; the tiers split evenly
            below it, low tiers first, and "No tier" ends the second column. */}
        <div className="flex flex-col gap-1">
          <Link
            href={tierHref(null)}
            scroll={false}
            aria-current={selected == null ? "true" : undefined}
            className={allTiersClasses(selected == null)}
          >
            All tiers
            <span className="text-text-subtle text-xs font-normal tabular-nums">
              {number.format(total)} maps
            </span>
          </Link>
          <ul
            style={{ "--rows": rows } as CSSProperties}
            className="grid grid-flow-col grid-cols-[auto_auto_auto_auto_auto_auto] grid-rows-[repeat(var(--rows),auto)] gap-x-2 gap-y-0.5 text-sm"
          >
            {slices.slice(0, half).map(tierRow)}
            {slices.slice(half).map(tierRow)}
            {untiered > 0 && (
              <li
                className={classNames(
                  rowClasses,
                  "text-text-muted",
                  selected != null && "opacity-40",
                )}
              >
                No tier
                <span className="text-right tabular-nums">
                  {number.format(untiered)}
                </span>
                <span className="text-text-subtle tabular-nums">
                  {percent.format(untiered / total)}
                </span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
