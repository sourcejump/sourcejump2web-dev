// What a run's replay shows before the viewer is loaded: the run's route from above, drawn in as the page
// appears. Nothing heavy loads with the page; the map and the viewer come only when someone asks to watch.
import type { CSSProperties } from "react";
import type { Schemas } from "@/api/client";
import { formatTime } from "@/features/runs/time";
import { Badge } from "@/ui/Badge";

// The route is fitted into a fixed 16:9 drawing, so lines and dots keep one size whatever the map's scale.
const WIDTH = 1600;
const HEIGHT = 900;
const MARGIN = 80;
const GRID = 64;

export function ReplayPoster({ run }: { run: Schemas["RunDetail"] }) {
  const points = fit(run.replay?.route ?? []);
  const start = points[0];
  const finish = points.at(-1);
  return (
    <div className="bg-surface border-border relative aspect-video w-full overflow-hidden rounded-md border">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="absolute inset-0 size-full"
        role="img"
        aria-label={`${run.player.name}'s route on ${run.map}, seen from above`}
      >
        <defs>
          <pattern
            id="replay-grid"
            width={GRID}
            height={GRID}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M${GRID} 0H0V${GRID}`}
              fill="none"
              className="stroke-border"
              strokeWidth={2}
            />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#replay-grid)" />
        {points.length > 1 && (
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(" ")}
            pathLength={1}
            fill="none"
            className="stroke-accent motion-draw"
            // In screen pixels, so the line reads the same on a phone and a wide screen.
            vectorEffect="non-scaling-stroke"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {start && (
          <circle cx={start[0]} cy={start[1]} r={14} className="fill-success" />
        )}
        {finish && points.length > 1 && (
          // Appears as the line reaches it.
          <circle
            cx={finish[0]}
            cy={finish[1]}
            r={14}
            className="fill-warning motion-enter"
            style={{ "--motion-delay": "1800ms" } as CSSProperties}
          />
        )}
      </svg>
      <div className="bg-bg/80 absolute bottom-3 left-3 flex items-center gap-2 rounded-md px-2 py-1 text-sm">
        <span className="font-bold">{run.player.name}</span>
        <span className="text-accent tabular-nums">{formatTime(run.time)}</span>
        {run.rank === 1 && !run.invalidated && <Badge tone="accent">WR</Badge>}
      </div>
    </div>
  );
}

/** Scales the route into the drawing, centred, north up (Source's y points north; SVG's points down). */
function fit(points: number[][]): [number, number][] {
  // The API sends [x, y] pairs; its schema can only say "arrays of numbers".
  const route = points.map(([x = 0, y = 0]) => [x, y] as const);
  if (route.length === 0) return [];
  const xs = route.map(([x]) => x);
  const ys = route.map(([, y]) => y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(
    (WIDTH - 2 * MARGIN) / Math.max(maxX - minX, 1),
    (HEIGHT - 2 * MARGIN) / Math.max(maxY - minY, 1),
  );
  const left = (WIDTH - (maxX - minX) * scale) / 2;
  const top = (HEIGHT - (maxY - minY) * scale) / 2;
  return route.map(([x, y]) => [
    Math.round(left + (x - minX) * scale),
    Math.round(top + (maxY - y) * scale),
  ]);
}
