"use client";
// A chart of the site's daily totals over a month, a year or all time: players with a recorded time on the
// Players page, runs and world records per day on the Activity page. Hovering, tapping or arrow keys read a
// point. Every range arrives with the page, so switching is instant.
import { type ReactNode, useState } from "react";
import type { Schemas } from "@/api/client";
import { Card } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import { LineChart } from "@/ui/LineChart";
import { Segmented } from "@/ui/Segmented";

export type TotalsRange = Schemas["TotalsRange"];

export type DailyTotalsData =
  | {
      kind: "players";
      ranges: Partial<Record<TotalsRange, Schemas["PlayerTotals"]>>;
    }
  | {
      kind: "runs";
      ranges: Partial<Record<TotalsRange, Schemas["RunTotals"]>>;
    };

const ranges: { value: TotalsRange; label: string }[] = [
  { value: "month", label: "1 month" },
  { value: "year", label: "1 year" },
  { value: "all", label: "All time" },
];

// UTC, like every date on the site, so the server and the visitor render the same text.
const day = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const date = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const count = new Intl.NumberFormat("en");
// Axis labels sit in a narrow column, so thousands are shortened: "6K".
const axis = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface Point {
  day: string;
  y: number;
  y2?: number;
}

export function DailyTotalsChart({
  data,
  initialRange,
  heading,
  plain = false,
}: {
  data: DailyTotalsData;
  initialRange: TotalsRange;
  heading?: string;
  plain?: boolean;
}) {
  const [range, setRange] = useState<TotalsRange>(initialRange);
  const [active, setActive] = useState<number | null>(null);
  const current = data.ranges[range];
  const points: Point[] =
    data.kind === "players"
      ? (data.ranges[range]?.points ?? []).map((p) => ({
          day: p.day,
          y: p.players,
        }))
      : (data.ranges[range]?.points ?? []).map((p) => ({
          day: p.day,
          y: p.runs,
          y2: p.world_records,
        }));
  const shown = points[active ?? points.length - 1];
  // Hidden only when nothing loaded: a range too short to draw (all time on a fresh site is one day) keeps the
  // card, so the other ranges can still be picked.
  if (!ranges.some((r) => data.ranges[r.value])) return null;
  const bucketDays = current?.bucket_days ?? 1;
  const rangeLabel = ranges.find((r) => r.value === range)?.label ?? "";

  const stats = shown && (
    <p
      aria-live="polite"
      className="text-text-muted flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm tabular-nums max-sm:justify-center"
    >
      {data.kind === "players" ? (
        <Stat value={shown.y}>
          {shown.y === 1 ? "player" : "players"} with a recorded time
        </Stat>
      ) : (
        <>
          {/* Each number in its line's color, so the line reads as the legend. */}
          <Stat value={shown.y} tone="text-accent">
            {shown.y === 1 ? "run" : "runs"}
          </Stat>
          <Dot />
          <Stat value={shown.y2 ?? 0} tone="text-gold">
            {shown.y2 === 1 ? "world record" : "world records"}
          </Stat>
        </>
      )}
      <Dot className="max-sm:hidden" />
      <span className="text-text-subtle max-sm:w-full max-sm:text-center">
        {when(shown.day, bucketDays)}
      </span>
    </p>
  );

  const plot =
    points.length < 2 ? (
      <p
        className={classNames(
          "text-text-subtle flex h-28 items-center justify-center text-sm",
          plain && "bg-bg",
        )}
      >
        {current
          ? "Not enough days yet to draw a chart."
          : "This range couldn't be loaded."}
      </p>
    ) : (
      <div
        className={classNames(
          "flex flex-col gap-1",
          // Darker than the board, so the trace reads as a screen rather than more flat fill.
          plain && "bg-bg px-4 pt-2 pb-3",
        )}
      >
        <LineChart
          size="sm"
          label={
            data.kind === "players"
              ? `Players with a recorded time, ${rangeLabel.toLowerCase()}. Use the arrow keys to read each point.`
              : `Runs and world records per ${bucketDays === 1 ? "day" : `${bucketDays} days`}, ${rangeLabel.toLowerCase()}. Use the arrow keys to read each point.`
          }
          points={points.map((p) => ({
            x: Date.parse(p.day),
            y: p.y,
            y2: p.y2,
          }))}
          active={active}
          onActive={setActive}
          formatValue={(value) => axis.format(Math.round(value))}
        />
        {/* Indented by the value labels' width, so the dates sit under the plot's ends. */}
        <div className="text-text-subtle flex justify-between pl-10 text-xs tabular-nums max-sm:pl-0">
          <span>{date.format(new Date(points[0]?.day ?? 0))}</span>
          <span>{date.format(new Date(points.at(-1)?.day ?? 0))}</span>
        </div>
      </div>
    );

  const frame = (
    <>
      <div
        className={classNames(
          "flex flex-wrap items-center justify-between gap-3 max-sm:justify-center",
          plain && "px-4",
        )}
      >
        {heading ? (
          <div className="flex min-w-0 flex-col gap-1 max-sm:items-center">
            <h1 className="text-xl font-bold">{heading}</h1>
            {stats}
          </div>
        ) : (
          stats
        )}
        <Segmented
          label="Range"
          fillOnPhones
          options={ranges}
          value={range}
          onChange={(value) => {
            setRange(value as TotalsRange);
            setActive(null);
          }}
        />
      </div>
      {plot}
    </>
  );

  if (plain) return <div className="flex flex-col gap-3 pt-4">{frame}</div>;
  return <Card className="flex flex-col gap-3">{frame}</Card>;
}

function Stat({
  value,
  tone = "text-text",
  children,
}: {
  value: number;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <span>
      <span className={`font-bold ${tone}`}>{count.format(value)}</span>{" "}
      {children}
    </span>
  );
}

function Dot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={`text-text-subtle ${className ?? ""}`}>
      ·
    </span>
  );
}

/** The days a point covers: one date, or a span of them. */
function when(start: string, bucketDays: number): string {
  const first = new Date(start);
  if (bucketDays <= 1) return date.format(first);
  const last = new Date(first.getTime() + (bucketDays - 1) * 86_400_000);
  return `${day.format(first)} – ${date.format(last)}`;
}
