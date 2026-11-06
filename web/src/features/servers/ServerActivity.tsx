"use client";
// Players online across listed servers over the last day, week, month or year. Hovering, tapping or arrow
// keys read a point: players and servers at that time. Every range arrives with the page, so switching is
// instant.
import { type ReactNode, useState } from "react";
import type { Schemas } from "@/api/client";
import { Card } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import { LineChart } from "@/ui/LineChart";
import { Segmented } from "@/ui/Segmented";

type Range = Schemas["ActivityRange"];

const ranges: { value: Range; label: string }[] = [
  { value: "day", label: "24 hours" },
  { value: "week", label: "7 days" },
  { value: "month", label: "1 month" },
  { value: "year", label: "1 year" },
];

// UTC, like every date on the site, so the server and the visitor render the same text.
const time = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const day = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const date = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function ServerActivity({
  activity,
}: {
  activity: Partial<Record<Range, Schemas["ServerActivity"]>>;
}) {
  const [range, setRange] = useState<Range>("day");
  const [active, setActive] = useState<number | null>(null);
  const current = activity[range];
  const points = current?.points ?? [];
  // The longer ranges' buckets are averages, so "now" always comes from the day's.
  const now = activity.day?.points.at(-1) ?? points.at(-1);
  const hovered = active === null ? undefined : points[active];
  if (!current || !now || points.length < 2) return null;
  const peak = Math.max(...points.map((point) => point.players));

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 max-sm:justify-center">
        <p
          aria-live="polite"
          className="text-text-muted flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm tabular-nums max-sm:justify-center"
        >
          {hovered ? (
            <>
              <Stat value={hovered.players}>
                {hovered.players === 1 ? "player" : "players"}
                {range !== "day" && " on average"}
              </Stat>
              <Dot />
              <Stat value={hovered.servers}>
                {hovered.servers === 1 ? "server" : "servers"}
              </Stat>
              <Dot />
              <span className="text-text-subtle">
                {when(hovered.at, current.bucket_minutes)}
              </span>
            </>
          ) : (
            <>
              <Stat
                value={now.players}
                tone={now.players > 0 ? "text-success" : "text-danger"}
              >
                online now
              </Stat>
              <Dot />
              <Stat value={now.servers}>
                {now.servers === 1 ? "server" : "servers"}
              </Stat>
              <Dot />
              <Stat value={peak}>peak in {rangeLabel(range)}</Stat>
            </>
          )}
        </p>
        <Segmented
          label="Range"
          fillOnPhones
          options={ranges}
          value={range}
          onChange={(value) => {
            setRange(value as Range);
            setActive(null);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <LineChart
          size="sm"
          label={`Players online over the last ${rangeLabel(range)}. Use the arrow keys to read each point.`}
          points={points.map((p) => ({ x: Date.parse(p.at), y: p.players }))}
          active={active}
          onActive={setActive}
          formatValue={(value) => String(Math.round(value))}
        />
        {/* Indented by the value labels' width, so the dates sit under the plot's ends. */}
        <div className="text-text-subtle flex justify-between pl-10 text-xs tabular-nums max-sm:pl-0">
          <span>{edge(points[0]?.at, range)}</span>
          <span>{edge(points.at(-1)?.at, range)}</span>
        </div>
      </div>
    </Card>
  );
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
      <span className={classNames("font-bold", tone)}>{value}</span> {children}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-text-subtle">
      ·
    </span>
  );
}

function rangeLabel(range: Range): string {
  return ranges.find((r) => r.value === range)?.label ?? "";
}

/** The bucket a point covers: a time span within a day, or the whole day. */
function when(at: string, minutes: number): string {
  const start = new Date(at);
  if (minutes >= 1440) return date.format(start);
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${day.format(start)}, ${time.format(start)}–${time.format(end)} UTC`;
}

/** The time axis's ends: times for a day, dates for longer, with the year for a year. */
function edge(at: string | undefined, range: Range): string {
  if (!at) return "";
  const start = new Date(at);
  if (range === "day") return `${time.format(start)} UTC`;
  return range === "year" ? date.format(start) : day.format(start);
}
