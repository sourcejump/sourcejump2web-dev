// A map's difficulty tier, colored by where it sits between the easiest and hardest tier.
import type { CSSProperties } from "react";

/** Number of `--color-tier-N` stops in tokens.css. */
const stops = 4;

/**
 * The tier count is staff-editable data (docs/domain.md), so colors come from the tier's position
 * on a ramp rather than a fixed color per tier. Returns a CSS color built from the ramp tokens.
 */
export function tierColor(tier: number, tierCount: number): string {
  const position =
    tierCount <= 1 ? 0 : Math.min(Math.max((tier - 1) / (tierCount - 1), 0), 1);
  const scaled = position * (stops - 1);
  const segment = Math.min(Math.floor(scaled), stops - 2);
  const mix = Math.round((scaled - segment) * 100);
  const from = `var(--color-tier-${segment + 1})`;
  const to = `var(--color-tier-${segment + 2})`;
  if (mix === 0) return from;
  if (mix === 100) return to;
  return `color-mix(in oklch, ${to} ${mix}%, ${from})`;
}

export function TierBadge({
  tier,
  tierCount,
}: {
  tier: number;
  tierCount: number;
}) {
  const color = tierColor(tier, tierCount);
  // A faint fill of the tier's own color behind the border, so the badge reads as a colored chip at a glance.
  const style = {
    "--tier": color,
    "--tier-tint": `color-mix(in oklch, ${color} 15%, transparent)`,
  } as CSSProperties;
  return (
    <span
      style={style}
      title={`Tier ${tier} of ${tierCount}`}
      className="inline-flex h-5 items-center rounded-sm border border-(color:--tier) bg-(color:--tier-tint) px-1.5 text-xs font-bold text-(color:--tier)"
    >
      T{tier}
    </span>
  );
}
