"use client";
// One count over time as a line from zero, e.g. players online, optionally with a second count on the same
// scale, e.g. world records among runs. Hovering, tapping or arrow keys pick a point and report it through
// `onActive`; the parent shows the values, so no tooltip covers the line.
import { type KeyboardEvent, type PointerEvent } from "react";
import { classNames } from "./classNames";

export interface LinePoint {
  /** Milliseconds since the epoch. */
  x: number;
  y: number;
  /** The second line's value here, when there is one: a part of `y`, drawn on the same scale. */
  y2?: number;
}

// The plot is drawn in this box and stretched to the chart's size by CSS, so it fills its container from the
// first paint, before any script runs. Strokes don't stretch (`non-scaling-stroke`), and the marker is HTML
// placed in percentages, so it stays round.
const W = 1000;
const H = 100;

/** The y axis starts at zero, so the line's height reads as an amount. */
export function LineChart({
  points,
  active,
  onActive,
  formatValue,
  label,
  size = "md",
}: {
  /** Oldest first, evenly spaced. */
  points: LinePoint[];
  active: number | null;
  onActive: (index: number | null) => void;
  formatValue: (value: number) => string;
  /** Read out for the chart, since it's a picture. */
  label: string;
  /** `sm` is shorter, and on a phone shows only the top value so the line spans the card. */
  size?: "sm" | "md";
}) {
  if (points.length < 2) return null;
  const top = niceMax(Math.max(...points.map((point) => point.y)));
  // The middle gridline only when it's a whole number: counts don't come in halves.
  const ticks = Number.isInteger(top / 2) ? [top, top / 2, 0] : [top, 0];
  const x = (index: number) => (index / (points.length - 1)) * W;
  const y = (value: number) => (1 - value / top) * H;

  const path = (value: (point: LinePoint) => number) =>
    points
      .map(
        (point, index) => `${index ? "L" : "M"}${x(index)},${y(value(point))}`,
      )
      .join(" ");
  const line = path((point) => point.y);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const second = points.some((point) => point.y2 !== undefined)
    ? path((point) => point.y2 ?? 0)
    : undefined;
  const shown = active === null ? undefined : points[active];

  function nearest(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width;
    const index = Math.round(position * (points.length - 1));
    return Math.min(Math.max(index, 0), points.length - 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? points.length - 1;
    const next = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: points.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onActive(Math.min(Math.max(next, 0), points.length - 1));
  }

  // Vertical padding leaves room for the top and bottom value labels, which center on their gridlines.
  return (
    <div
      className={classNames("flex gap-2 py-2", size === "sm" ? "h-28" : "h-40")}
    >
      <div
        aria-hidden
        className={classNames(
          "text-text-subtle relative w-8 shrink-0 text-right text-xs tabular-nums",
          size === "sm" && "max-sm:hidden",
        )}
      >
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${(y(tick) / H) * 100}%` }}
          >
            {formatValue(tick)}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={label}
        tabIndex={0}
        className="focus-visible:ring-accent relative flex-1 cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-2"
        onPointerMove={(event) => onActive(nearest(event))}
        onPointerDown={(event) => onActive(nearest(event))}
        onPointerLeave={() => onActive(null)}
        onFocus={() => onActive(points.length - 1)}
        onBlur={() => onActive(null)}
        onKeyDown={onKeyDown}
      >
        {size === "sm" && (
          <span
            aria-hidden
            className="text-text-subtle pointer-events-none absolute top-0 left-0 -translate-y-full text-xs tabular-nums sm:hidden"
          >
            {formatValue(top)}
          </span>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={W}
              y1={y(tick)}
              y2={y(tick)}
              vectorEffect="non-scaling-stroke"
              className="stroke-border"
            />
          ))}
          <path d={area} className="fill-accent-soft" />
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-accent"
          />
          {second && (
            <path
              d={second}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-gold"
            />
          )}
        </svg>
        {shown && active !== null && (
          <>
            <span
              aria-hidden
              className="bg-border-strong pointer-events-none absolute inset-y-0 w-px"
              style={{ left: `${(x(active) / W) * 100}%` }}
            />
            <span
              aria-hidden
              className="bg-accent border-surface pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              style={{
                left: `${(x(active) / W) * 100}%`,
                top: `${(y(shown.y) / H) * 100}%`,
              }}
            />
            {shown.y2 !== undefined && (
              <span
                aria-hidden
                className="bg-gold border-surface pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                style={{
                  left: `${(x(active) / W) * 100}%`,
                  top: `${(y(shown.y2) / H) * 100}%`,
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The top of the axis: the first round number at or above `max` (1, 2, 3, 4, 5, 6 or 8 times a power of
 * ten), and at least 1. Fine enough steps that the line uses most of the chart's height.
 */
export function niceMax(max: number): number {
  if (max <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 3, 4, 5, 6, 8, 10].find((m) => m * power >= max) ?? 10;
  return step * power;
}
