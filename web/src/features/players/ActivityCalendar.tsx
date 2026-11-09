"use client";
// A player's year as a calendar: one square per UTC day, a column per week (Monday on top), deeper accent for
// busier days. Hovering a day names it and its runs in place of the year's summary.
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { formatDate } from "@/features/runs/time";
import { Card, Label } from "@/ui/Card";
import { classNames } from "@/ui/classNames";

const DAY_MS = 24 * 60 * 60 * 1000;
const number = new Intl.NumberFormat("en");
const month = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});
/** Runs from which a day takes each deeper shade. Fixed, so a quiet player's busiest day doesn't look busy. */
const SHADES = [
  { from: 11, className: "bg-accent" },
  { from: 6, className: "bg-accent/75" },
  { from: 3, className: "bg-accent/50" },
  { from: 1, className: "bg-accent/25" },
];

export function ActivityCalendar({
  days,
  today,
}: {
  /** Runs per UTC day, oldest first and today last. */
  days: number[];
  /** Today's UTC date (`YYYY-MM-DD`), as the server counted the days, so the server and browser agree. */
  today: string;
}) {
  const [hovered, setHovered] = useState<number>();
  const scroller = useRef<HTMLDivElement>(null);
  // On a phone the year is wider than the screen; start at the latest weeks.
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollLeft = box.scrollWidth;
  }, []);

  const first = Date.parse(`${today}T00:00:00Z`) - (days.length - 1) * DAY_MS;
  const dateOf = (index: number) => new Date(first + index * DAY_MS);
  // Monday-first weeks: blank squares before the first day line it up with its weekday.
  const lead = (dateOf(0).getUTCDay() + 6) % 7;
  const weeks = Math.ceil((lead + days.length) / 7);
  const columns = {
    gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
  } as CSSProperties;
  // A month's name over the week its first day falls in.
  const months = days.flatMap((_, index) => {
    const date = dateOf(index);
    return date.getUTCDate() === 1
      ? [{ week: Math.floor((lead + index) / 7), name: month.format(date) }]
      : [];
  });

  const runs = days.reduce((sum, count) => sum + count, 0);
  const active = days.filter((count) => count > 0).length;
  let streak = 0;
  let longest = 0;
  for (const count of days) {
    streak = count > 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const summary =
    runs === 0
      ? "No runs in the last year"
      : `${number.format(runs)} ${runs === 1 ? "run" : "runs"} on ${number.format(active)} ${active === 1 ? "day" : "days"}${longest > 1 ? ` · longest streak ${longest} days` : ""}`;
  const hoveredRuns = hovered != null ? days[hovered] : undefined;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>Runs in the last year</Label>
        <span
          className="text-text-muted text-sm tabular-nums"
          aria-live="polite"
        >
          {hovered != null && hoveredRuns != null
            ? `${formatDate(dateOf(hovered).toISOString())}: ${hoveredRuns} ${hoveredRuns === 1 ? "run" : "runs"}`
            : summary}
        </span>
      </div>
      <div ref={scroller} className="overflow-x-auto">
        <div className="flex min-w-192 gap-2">
          <div
            aria-hidden
            className="text-text-subtle grid shrink-0 grid-rows-7 gap-1 pt-5 text-xs"
          >
            {["Mon", "", "Wed", "", "Fri", "", ""].map((name, index) => (
              <span key={index} className="flex items-center leading-none">
                {name}
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              aria-hidden
              className="text-text-subtle grid h-4 text-xs"
              style={columns}
            >
              {months.map(({ week, name }) => (
                <span
                  key={`${week}-${name}`}
                  style={{ gridColumnStart: week + 1 } as CSSProperties}
                >
                  {name}
                </span>
              ))}
            </div>
            <div
              role="img"
              aria-label={`${summary}, one square per day`}
              className="grid grid-flow-col grid-rows-7 gap-1"
              style={columns}
              onPointerLeave={() => setHovered(undefined)}
            >
              {Array.from({ length: lead }, (_, index) => (
                <span key={`lead-${index}`} />
              ))}
              {days.map((count, index) => (
                <span
                  key={index}
                  onPointerEnter={() => setHovered(index)}
                  onPointerDown={() => setHovered(index)}
                  className={classNames(
                    "aspect-square rounded-sm",
                    SHADES.find((shade) => count >= shade.from)?.className ??
                      "bg-border",
                    hovered === index && "ring-text ring-1",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className="text-text-subtle flex items-center justify-end gap-1.5 text-xs"
      >
        Fewer
        {["bg-border", ...SHADES.map((shade) => shade.className).reverse()].map(
          (className) => (
            <span
              key={className}
              className={`${className} size-3 rounded-sm`}
            />
          ),
        )}
        More
      </div>
    </Card>
  );
}
