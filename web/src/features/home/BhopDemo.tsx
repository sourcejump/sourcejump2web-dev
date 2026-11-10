"use client";
// The home page's bhop demo: a simulated player hopping block to block, seen from above at an angle, with the
// keys they hold and their speed shown the way a bhop server's HUD shows them.
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { simulateStrafes, tickSeconds, type StrafeTick } from "./strafeSim";

const SECONDS = 9.5;
// Once the run ends it fades out, then starts again.
const FADE_SECONDS = 0.6;
// With reduced motion the demo shows one still moment, late enough that several hops are behind it.
const STILL_TICK = 620;

// The drawing, in its own units. The player stays at PLAYER_X while the course moves past, a little left of
// the middle so more of the course ahead shows than behind. The block tops sit at the middle height: the hops
// and strafes reach about as far above them as the blocks' sides reach below.
const WIDTH = 1000;
const HEIGHT = 440;
const PLAYER_X = 460;
const GROUND_Y = HEIGHT / 2;
// An oblique view: forward runs to the right, left runs up and a little right, height runs up. Height is drawn
// taller than it is, so the hops read as clearly as the strafes.
const SCALE = 0.75;
const DEPTH_X = 0.35;
const DEPTH_Y = 0.9;
const HEIGHT_Y = 1.3;
// Blocks stand on a floor this far below them; their tops are where the player lands.
const FLOOR = 48;
const BLOCK = 32;
// The floor's grid reaches further back than forward, and fades out towards the back.
const GRID = 64;
const GRID_BACK = 640;
const GRID_FRONT = 384;
// The trail keeps the last few seconds; older parts have left the drawing anyway.
const TRAIL_TICKS = 400;

type Point = readonly [number, number];

/**
 * Rounded to a tenth: Node and the browser can differ in a sine's last digits, and the server's drawing has to
 * match the browser's exactly for React to take it over.
 */
function project(x: number, y: number, z: number): Point {
  return [
    round((x + y * DEPTH_X) * SCALE),
    round(-(y * DEPTH_Y + z * HEIGHT_Y) * SCALE),
  ];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function points(list: readonly Point[]): string {
  return list.map(([x, y]) => `${x},${y}`).join(" ");
}

export function BhopDemo() {
  const ticks = useMemo(() => simulateStrafes(SECONDS + 1), []);
  const landings = useMemo(
    () => ticks.flatMap((tick, index) => (tick.jump ? [index] : [])),
    [ticks],
  );
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [still, setStill] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  // Plays only while on screen and not paused; the browser already pauses animation frames in hidden tabs.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once, after hydration
      setStill(true);
      return;
    }
    const element = frame.current;
    if (!element || !playing) return;
    let request = 0;
    let last = 0;
    let visible = false;
    const step = (now: number) => {
      const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      setTime((t) => {
        const next = t + delta;
        return next > SECONDS + FADE_SECONDS ? 0 : next;
      });
      request = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !visible) {
        visible = true;
        last = 0;
        request = requestAnimationFrame(step);
      } else if (!entry?.isIntersecting && visible) {
        visible = false;
        cancelAnimationFrame(request);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(request);
    };
  }, [playing]);

  const shown = still ? STILL_TICK * tickSeconds : Math.min(time, SECONDS);
  const exact = shown / tickSeconds;
  const index = Math.min(Math.floor(exact), ticks.length - 2);
  const now = lerp(ticks[index]!, ticks[index + 1]!, exact - index);
  const tick = ticks[index]!;
  const hop = landings.filter((landing) => landing <= index).length;
  const lastLanding = landings[hop - 1] ?? 0;
  const [playerX, playerY] = project(now.x, now.y, now.z);
  const [shadowX, shadowY] = project(now.x, now.y, -FLOOR);
  const [cameraX] = project(now.x, 0, 0);
  const trail = ticks.slice(Math.max(0, index - TRAIL_TICKS), index + 1);

  // The course doesn't move relative to itself, so it's built once and the camera slides over it.
  const course = useMemo(
    () => <Course ticks={ticks} landings={landings} />,
    [ticks, landings],
  );

  return (
    <div
      ref={frame}
      className="border-border bg-surface relative aspect-4/3 overflow-hidden rounded-lg border sm:aspect-16/7"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full mask-x-from-75% mask-x-to-100%"
        role="img"
        aria-label="A player hopping from block to block, swinging left and right and gaining speed with each hop"
      >
        <g
          className={classNames(
            "transition-opacity duration-(--duration-slow)",
            time > SECONDS && !still && "opacity-0",
          )}
        >
          <g transform={`translate(${PLAYER_X - cameraX} ${GROUND_Y})`}>
            {course}
            {/* Which blocks the player has landed on, and a ring where they just did. */}
            {landings.slice(0, hop).map((landing) => (
              <BlockTop
                key={landing}
                tick={ticks[landing]!}
                className="fill-accent-soft stroke-accent"
              />
            ))}
            {hop > 0 && !still && (
              <Ripple key={lastLanding} tick={ticks[lastLanding]!} />
            )}
            <polyline
              points={points(trail.map((t) => project(t.x, t.y, -FLOOR)))}
              fill="none"
              className="stroke-accent opacity-30"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={points(trail.map((t) => project(t.x, t.y, t.z)))}
              fill="none"
              className="stroke-accent opacity-20"
              strokeWidth={10}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={points(trail.map((t) => project(t.x, t.y, t.z)))}
              fill="none"
              className="stroke-accent"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <ellipse
              cx={shadowX}
              cy={shadowY}
              rx={12}
              ry={5}
              className="fill-bg opacity-70"
            />
            <circle
              cx={playerX}
              cy={playerY}
              r={16}
              className="fill-accent opacity-25"
            />
            <circle cx={playerX} cy={playerY} r={8} className="fill-accent" />
            <circle cx={playerX} cy={playerY} r={3} className="fill-text" />
          </g>
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-3 sm:p-5">
        <div className="flex items-end gap-3">
          <div className="grid grid-cols-3 gap-1">
            <Keycap className="col-start-2">W</Keycap>
            <Keycap on={tick.key === "A"} className="col-start-1">
              A
            </Keycap>
            <Keycap>S</Keycap>
            <Keycap on={tick.key === "D"}>D</Keycap>
            {/* Held throughout: with auto-bhop, the style most people play, the player never times a jump. */}
            <Keycap on className="col-span-3">
              Jump
            </Keycap>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-text-subtle text-xs tracking-widest uppercase">
              Mouse
            </span>
            <div className="flex gap-1">
              <Keycap on={tick.key === "A"} label="Turning left">
                <ArrowLeft aria-hidden className="size-3.5" />
              </Keycap>
              <Keycap on={tick.key === "D"} label="Turning right">
                <ArrowRight aria-hidden className="size-3.5" />
              </Keycap>
            </div>
          </div>
        </div>
        <div className="bg-bg/70 flex flex-col items-end rounded-md px-3 py-2">
          <span className="text-text-subtle text-xs tracking-widest uppercase">
            Speed
          </span>
          <span className="text-2xl leading-none font-bold tabular-nums sm:text-3xl">
            {Math.round(now.speed)}
            <span className="text-text-muted ml-1 text-sm font-normal">
              u/s
            </span>
          </span>
        </div>
      </div>

      {!still && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2"
          aria-label={playing ? "Pause the demo" : "Play the demo"}
          onClick={() => setPlaying((on) => !on)}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
      )}
    </div>
  );
}

/** The blocks under each landing and the floor below them, in course coordinates. */
function Course({
  ticks,
  landings,
}: {
  ticks: StrafeTick[];
  landings: number[];
}) {
  const fade = useId();
  const [start, end] = [-WIDTH, (ticks.at(-1)?.x ?? 0) + WIDTH * 2];
  const lines: [Point, Point][] = [];
  for (let x = start; x <= end; x += GRID) {
    lines.push([
      project(x, -GRID_FRONT, -FLOOR),
      project(x, GRID_BACK, -FLOOR),
    ]);
  }
  for (let y = -GRID_FRONT; y <= GRID_BACK; y += GRID) {
    lines.push([project(start, y, -FLOOR), project(end, y, -FLOOR)]);
  }
  const [, back] = project(0, GRID_BACK, -FLOOR);
  const [, middle] = project(0, 0, -FLOOR);
  // The mask's own box: left alone, a mask covers only the drawing's first screenful of the course.
  const [left] = project(start, -GRID_FRONT, -FLOOR);
  const [right, bottom] = project(end, -GRID_FRONT, -FLOOR);
  const area = {
    x: left,
    y: back,
    width: right + GRID_BACK * DEPTH_X * SCALE - left,
    height: bottom - back,
  };
  // Back blocks first, so nearer ones are drawn over them.
  const blocks = [...landings].sort((a, b) => ticks[b]!.y - ticks[a]!.y);
  return (
    <>
      {/* An alpha mask, so only the gradient's opacity counts and it needs no colour. */}
      <mask
        id={`${fade}-mask`}
        maskUnits="userSpaceOnUse"
        {...area}
        style={{ maskType: "alpha" }}
      >
        <linearGradient
          id={`${fade}-gradient`}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={back}
          x2={0}
          y2={middle}
        >
          <stop offset={0} stopOpacity={0} />
          <stop offset={1} stopOpacity={1} />
        </linearGradient>
        <rect {...area} fill={`url(#${fade}-gradient)`} />
      </mask>
      <g className="stroke-border" strokeWidth={1} mask={`url(#${fade}-mask)`}>
        {lines.map(([[x1, y1], [x2, y2]], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      {blocks.map((landing) => (
        <Block key={landing} tick={ticks[landing]!} start={landing === 0} />
      ))}
    </>
  );
}

/** A block standing on the floor, its top where the player lands. The start block is a start zone. */
function Block({ tick, start }: { tick: StrafeTick; start: boolean }) {
  const size = start ? BLOCK * 2 : BLOCK;
  const { x, y } = tick;
  const corner = (dx: number, dy: number, z: number) =>
    project(x + dx * size, y + dy * size, z);
  // Seen from the front and to the right: the front and right faces show, the back and left stay hidden.
  const front = [
    corner(-1, -1, 0),
    corner(1, -1, 0),
    corner(1, -1, -FLOOR),
    corner(-1, -1, -FLOOR),
  ];
  const right = [
    corner(1, -1, 0),
    corner(1, 1, 0),
    corner(1, 1, -FLOOR),
    corner(1, -1, -FLOOR),
  ];
  return (
    <g strokeWidth={1} strokeLinejoin="round">
      <polygon points={points(right)} className="fill-surface stroke-border" />
      <polygon
        points={points(front)}
        className="fill-surface-raised stroke-border"
      />
      <BlockTop
        tick={tick}
        size={size}
        className={
          start
            ? "fill-success-soft stroke-success"
            : "fill-surface-overlay stroke-border-strong"
        }
      />
    </g>
  );
}

function BlockTop({
  tick,
  size = BLOCK,
  className,
}: {
  tick: StrafeTick;
  size?: number;
  className: string;
}) {
  const { x, y } = tick;
  const top = [
    project(x - size, y - size, 0),
    project(x + size, y - size, 0),
    project(x + size, y + size, 0),
    project(x - size, y + size, 0),
  ];
  return (
    <polygon
      points={points(top)}
      className={classNames(
        "transition-colors duration-(--duration-base)",
        className,
      )}
      strokeWidth={1.5}
      strokeLinejoin="round"
    />
  );
}

/** A ring spreading from where the player just landed. */
function Ripple({ tick }: { tick: StrafeTick }) {
  const [cx, cy] = project(tick.x, tick.y, 0);
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={BLOCK * SCALE * 1.4}
      ry={BLOCK * SCALE * 0.7}
      fill="none"
      strokeWidth={2}
      className="stroke-accent motion-ripple"
    />
  );
}

function Keycap({
  on = false,
  label,
  className,
  children,
}: {
  on?: boolean;
  /** For keys drawn as an icon. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={label}
      className={classNames(
        "flex h-6 min-w-6 items-center justify-center rounded-sm border px-1.5 text-xs font-bold uppercase sm:h-7 sm:min-w-7",
        "transition-colors duration-(--duration-fast)",
        on
          ? "bg-accent border-accent text-on-accent"
          : "bg-bg/70 border-border text-text-subtle",
        className,
      )}
    >
      {children}
    </span>
  );
}

function lerp(a: StrafeTick, b: StrafeTick, amount: number) {
  const mix = (p: number, q: number) => p + (q - p) * amount;
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    // The jump resets height in one tick; blending across it would dip the player through the block.
    z: b.jump ? a.z : mix(a.z, b.z),
    speed: mix(a.speed, b.speed),
  };
}
