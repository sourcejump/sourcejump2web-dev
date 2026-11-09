// A ring split into slices, each a link to what it counts: the chosen slice grows and the others dim. The Maps
// page's tiers (TierSpread) and a profile's personal bests by style draw with it, so both move alike.
import type { CSSProperties, MouseEvent } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";

/** The ring's radius and width, in the SVG's 100-unit box. */
const RADIUS = 40;
const WIDTH = 16;
/** Space between slices, in hundredths of the ring. */
const GAP = 0.6;

export type DonutSlice = {
  key: string;
  value: number;
  /** A CSS color, such as `var(--color-series-1)`. */
  color: string;
  /** What the slice is, for its link's name and hint. */
  label: string;
  href: string;
  /** For a page that changes its view in place: call `preventDefault` to stay. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export function Donut({
  slices,
  rest = 0,
  selected,
  highlighted,
  label,
  value,
  caption,
}: {
  /** Slices with no value draw nothing. */
  slices: DonutSlice[];
  /** A part that isn't a link, drawn at the ring's end in a neutral color (maps without a tier). */
  rest?: number;
  /** The chosen slice's key; the others dim. */
  selected?: string;
  /** A slice to grow as if hovered, while its row in a legend beside the ring is. */
  highlighted?: string;
  /** The chart's name for screen readers. */
  label: string;
  /** The middle: a short figure, and a line under it. */
  value: string;
  caption?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, rest);
  // Each slice is a dashed stroke around the ring: as long as its share, starting where the last one ended.
  // Strokes rather than wedge paths, so a slice is one circle and grows its width on hover.
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const placed = slices.map((slice, index) => ({
    ...slice,
    start: share(
      slices.slice(0, index).reduce((sum, before) => sum + before.value, 0),
    ),
    length: share(slice.value),
  }));
  const restStart = share(total - rest);

  return (
    <svg
      viewBox="0 0 100 100"
      className="size-36 shrink-0 -rotate-90"
      role="img"
      aria-label={label}
    >
      {total === 0 && (
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={WIDTH}
          className="stroke-surface-raised"
        />
      )}
      {rest > 0 && (
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          pathLength={100}
          strokeWidth={WIDTH}
          className="stroke-surface-raised"
          strokeDasharray={`${Math.max((rest / total) * 100 - GAP, 0)} 100`}
          strokeDashoffset={-restStart}
        />
      )}
      {placed.map(
        (slice) =>
          slice.value > 0 && (
            <Link
              key={slice.key}
              href={slice.href}
              scroll={false}
              onClick={slice.onClick}
              aria-label={slice.label}
            >
              <title>{slice.label}</title>
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                pathLength={100}
                strokeWidth={WIDTH}
                // Very small parts still show as a sliver rather than vanishing into the gap.
                strokeDasharray={`${Math.max(slice.length - GAP, 0.3)} 100`}
                strokeDashoffset={-slice.start}
                style={{ "--slice": slice.color } as CSSProperties}
                className={classNames(
                  "stroke-(--slice) transition-[opacity,stroke-width] duration-(--duration-base) hover:stroke-[19]",
                  selected != null && selected !== slice.key && "opacity-25",
                  (selected === slice.key || highlighted === slice.key) &&
                    "stroke-[19]",
                )}
              />
            </Link>
          ),
      )}
      {/* Counter-rotated, so the middle reads upright inside the turned ring. */}
      <g className="[transform-origin:50px_50px] rotate-90">
        <text
          x="50"
          y={caption ? 48 : 54}
          textAnchor="middle"
          className="fill-text text-[13px] font-bold tabular-nums"
        >
          {value}
        </text>
        {caption && (
          <text
            x="50"
            y="61"
            textAnchor="middle"
            className="fill-text-muted text-[8px] tabular-nums"
          >
            {caption}
          </text>
        )}
      </g>
    </svg>
  );
}
