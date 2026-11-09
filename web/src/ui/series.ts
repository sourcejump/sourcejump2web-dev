// The color of a chart's part by its fixed place in a list (a style by its place in the ruleset), never by its size.

const SERIES_COLORS = 8;

/** `index` counts from 0. Parts past the eighth share the neutral color, rather than one too close to another. */
export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES_COLORS
    ? `var(--color-series-${index + 1})`
    : "var(--color-series-other)";
}
