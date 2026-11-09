// A player's last 30 days at a glance: one bar per UTC day, taller for more runs, oldest on the left.
import type { CSSProperties } from "react";
import { classNames } from "@/ui/classNames";

/** Runs at which a day's bar reaches full height; busier days look the same. */
const FULL = 10;

export function ActivityStrip({ days }: { days: number[] }) {
  const runs = days.reduce((sum, count) => sum + count, 0);
  const label = `${runs} ${runs === 1 ? "run" : "runs"} in the last ${days.length} days`;
  return (
    <span className="flex items-center gap-3" title={label}>
      <span aria-hidden className="flex h-5 items-end gap-px">
        {days.map((count, index) => (
          <span
            key={index}
            className={classNames(
              "w-0.75",
              count > 0 ? "bg-accent" : "bg-border-strong",
            )}
            // A day without runs keeps a short stub, so the strip reads as 30 days, not a few bars.
            style={
              {
                height: `${count > 0 ? 25 + (Math.min(count, FULL) / FULL) * 75 : 10}%`,
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="text-text-muted text-sm">
        {runs} {runs === 1 ? "run" : "runs"}
      </span>
    </span>
  );
}
