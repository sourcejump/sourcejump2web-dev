"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { formatDate } from "@/features/runs/time";
import type { ProfileHistoryPoint } from "./sampleHistory";
import styles from "./ProfileHistory.module.css";

const number = new Intl.NumberFormat("en");
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const month = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});
const W = 1000;
const H = 220;

export function ProfileHistory({
  series,
  styleName,
  bonuses = false,
}: {
  series?: ProfileHistoryPoint[];
  styleName: string;
  bonuses?: boolean;
}) {
  const [metric, setMetric] = useState<"rank" | "points" | "worldRecords">(
    "rank",
  );
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const title = {
    rank: "Rank",
    points: "Points",
    worldRecords: "World records",
  }[metric];
  const context = `${styleName}${metric === "worldRecords" ? " · All tracks" : bonuses ? " bonuses" : ""}`;
  const format = (value: number) =>
    metric === "rank" ? `#${number.format(value)}` : number.format(value);
  const values = series?.map((point) => point[metric]) ?? [];
  const min =
    metric === "rank" && values.length
      ? Math.max(1, Math.min(...values) - 1)
      : 0;
  const max = Math.max(min + 4, ...values);
  const y = (value: number) =>
    (metric === "rank"
      ? (value - min) / (max - min)
      : (max - value) / (max - min)) * H;
  const coords =
    series?.map((point, index) => ({
      x: (index / (series.length - 1)) * W,
      y: y(point[metric]),
    })) ?? [];
  const path = coords
    .map((point, index) => {
      if (!index) return `M${point.x},${point.y}`;
      const previous = coords[index - 1]!;
      const mid = (previous.x + point.x) / 2;
      return `C${mid},${previous.y} ${mid},${point.y} ${point.x},${point.y}`;
    })
    .join(" ");
  const ticks = Array.from({ length: 5 }, (_, i) =>
    Math.round(min + ((max - min) * i) / 4),
  );
  const selected = active === null ? undefined : series?.[active];

  function nearest(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setActive(
      Math.max(
        0,
        Math.min(
          coords.length - 1,
          Math.round(
            ((event.clientX - bounds.left) / bounds.width) *
              (coords.length - 1),
          ),
        ),
      ),
    );
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? coords.length - 1;
    const next = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: coords.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(coords.length - 1, next)));
  }

  return (
    <section
      aria-label="Player history"
      className="border-border bg-surface flex flex-col gap-4 rounded-md border p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">
          {title}, last 12 months · {context}
        </h2>
        <ChoiceMenu
          label="Show"
          value={metric}
          options={[
            { value: "rank", label: "Rank" },
            { value: "points", label: "Points" },
            { value: "worldRecords", label: "World records" },
          ]}
          onChange={(value) =>
            setMetric(
              value === "points" || value === "worldRecords" ? value : "rank",
            )
          }
        />
      </div>
      {series && series.length > 1 ? (
        <>
          <p aria-live="polite" className="text-text-subtle text-xs">
            {selected
              ? `${formatDate(selected.date)} · ${format(selected[metric])} · sample history`
              : "Sample history"}
          </p>
          <div className="flex gap-3">
            <div
              aria-hidden
              className="text-text-subtle relative mb-6 w-10 shrink-0 text-right text-xs tabular-nums"
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-0 -translate-y-1/2"
                  style={{ top: `${(y(tick) / H) * 100}%` }}
                >
                  {metric === "rank" ? `#${tick}` : compact.format(tick)}
                </span>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div
                role="img"
                aria-label={`Sample ${title.toLowerCase()} history for ${context}. Use the arrow keys to read each month.`}
                tabIndex={0}
                onPointerMove={nearest}
                onPointerDown={nearest}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(coords.length - 1)}
                onBlur={() => setActive(null)}
                onKeyDown={navigate}
                className="focus-visible:ring-accent relative h-48 cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-2 sm:h-60"
              >
                <svg
                  aria-hidden
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 size-full overflow-visible"
                >
                  <defs>
                    <clipPath id={`${id}-clip`}>
                      <rect
                        key={`${metric}-${context}`}
                        width={W}
                        height={H}
                        className={styles.reveal}
                      />
                    </clipPath>
                    <linearGradient
                      id={`${id}-fill`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--color-accent)"
                        stopOpacity="0.2"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-accent)"
                        stopOpacity="0.01"
                      />
                    </linearGradient>
                  </defs>
                  {ticks.map((tick) => (
                    <line
                      key={tick}
                      x1="0"
                      x2={W}
                      y1={y(tick)}
                      y2={y(tick)}
                      className="stroke-border"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <g clipPath={`url(#${id}-clip)`}>
                    <path
                      d={`${path} L${W},${H} L0,${H} Z`}
                      fill={`url(#${id}-fill)`}
                    />
                    <path
                      d={path}
                      fill="none"
                      className="stroke-accent"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                </svg>
                {active !== null && coords[active] && (
                  <span
                    aria-hidden
                    className="border-surface bg-accent pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                    style={{
                      left: `${(coords[active].x / W) * 100}%`,
                      top: `${(coords[active].y / H) * 100}%`,
                    }}
                  />
                )}
              </div>
              <div
                aria-hidden
                className="text-text-subtle grid grid-cols-12 text-center text-xs"
              >
                {series.map((point, index) => (
                  <span
                    key={point.date}
                    className={`first:text-left last:text-right ${index % 3 !== 0 && index !== series.length - 1 ? "max-sm:invisible" : ""}`}
                  >
                    {month.format(new Date(point.date))}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-text-muted py-12 text-sm">
          {title} history isn&apos;t available for this player yet.
        </p>
      )}
    </section>
  );
}
