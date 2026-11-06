"use client";
// A run's replay on its page: the poster until play is pressed, then the map drawn in the browser with the
// replay playing in it. The viewer's code and the map's file details load while the poster shows; the map
// itself downloads only on that press, or when the page is opened at #replay (the run dialog's "Watch replay").
import { LoaderCircle, Play } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api, type Schemas } from "@/api/client";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { type Lighting, storedLighting, storeLighting } from "./lighting";
import {
  type ComparisonRun,
  comparisonRun,
  findComparison,
} from "./comparison";
import { REPLAY_ANCHOR } from "./anchor";
import { ComparisonLegend } from "./ComparisonLegend";
import { storedOverlays, storeOverlays } from "./overlays";
import { type ControlsHandle, ReplayControls } from "./ReplayControls";
import { type HudHandle, ReplayHud } from "./ReplayHud";
import { ReplayPoster } from "./ReplayPoster";
import { useTextureCapTest } from "./textureCapTest";
import type { InterpolationMode } from "./viewer/playback";
import { parseRunId } from "./runId";
import type { Follow, Overlays, ViewerSession } from "./viewer/session";

type Phase =
  | { kind: "poster" }
  | { kind: "loading" }
  | { kind: "ready"; session: ViewerSession }
  | { kind: "failed"; message: string };

// Smoothing is a viewer's taste, so it's remembered in this browser. Storage can be blocked (private
// windows), in which case the default holds.
const SMOOTHING_KEY = "sj.replay.smoothing";
const SMOOTHING_MODES: InterpolationMode[] = ["smooth", "faithful", "exact"];
function storedSmoothing(): InterpolationMode {
  try {
    const stored = localStorage.getItem(SMOOTHING_KEY);
    return SMOOTHING_MODES.find((mode) => mode === stored) ?? "smooth";
  } catch {
    return "smooth";
  }
}

/** The address points at the replay, as the run dialog's link does. The server never sees the hash. */
function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const openedAtReplay = () => window.location.hash === `#${REPLAY_ANCHOR}`;

/** The map's details (with its viewer file) and the viewer's code: small next to the map, which waits for play. */
function prepareViewer(map: string) {
  return Promise.all([
    api.GET("/v1/maps/{map}", { params: { path: { map } } }),
    import("./viewer/session"),
  ]);
}
type Prepared = { map: string; loading: ReturnType<typeof prepareViewer> };

export function ReplayPlayer({
  run,
  styleNames,
  startNow = false,
}: {
  run: Schemas["RunDetail"];
  /** Ranked styles' names by key, for a compared run of another style. */
  styleNames: Record<string, string>;
  /** Start without waiting for a press, as in the replay dialog. */
  startNow?: boolean;
}) {
  const [pressedPhase, setPhase] = useState<Phase>({ kind: "poster" });
  const openedAtAnchor = useSyncExternalStore(
    subscribeToHash,
    openedAtReplay,
    () => false,
  );
  const autoStart = startNow || openedAtAnchor;
  const phase: Phase =
    pressedPhase.kind === "poster" && autoStart
      ? { kind: "loading" }
      : pressedPhase;
  const [playing, setPlaying] = useState(true);
  const [freecam, setFreecam] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [smoothing, setSmoothing] = useState<InterpolationMode>("smooth");
  const [lighting, setLighting] = useState<Lighting>("lit");
  const [idle, setIdle] = useState(false);
  const [comparison, setComparison] = useState<ComparisonRun | null>(null);
  /** The run compared with when the replay starts: the record, or the next best. */
  const [usual, setUsual] = useState<ComparisonRun | null>(null);
  const [follow, setFollow] = useState<Follow>("run");
  const [comparing, setComparing] = useState<{
    busy: boolean;
    problem: string | null;
  }>({ busy: false, problem: null });
  const [overlays, setOverlays] = useState<Overlays>({
    paths: false,
    players: false,
  });
  const compareAbort = useRef<AbortController | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  /** Holds the viewer's canvas, which each start makes anew. */
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<ControlsHandle>(null);
  const hudRef = useRef<HudHandle>(null);
  const playingRef = useRef(true);

  const replayUrl = run.replay?.sjr_url;
  const started = phase.kind !== "poster";

  // Started while the poster shows, so pressing play goes straight to the map download. A failed attempt is
  // forgotten, so play tries again.
  const prepared = useRef<Prepared | null>(null);
  const prepare = useCallback(() => {
    const current = prepared.current;
    if (current?.map === run.map) return current.loading;
    const next = { map: run.map, loading: prepareViewer(run.map) };
    prepared.current = next;
    next.loading.catch(() => {
      if (prepared.current === next) prepared.current = null;
    });
    return next.loading;
  }, [run.map]);
  useEffect(() => {
    if (started || !replayUrl) return;
    // After the page's own loading, so the run's details aren't held up by the viewer.
    const idle = window.requestIdleCallback ?? ((then) => setTimeout(then, 1));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => void prepare().catch(() => {}));
    return () => cancel(id);
  }, [started, replayUrl, prepare]);

  useEffect(() => {
    if (!started || !replayUrl) return;
    const abort = new AbortController();
    let session: ViewerSession | undefined;
    let canvas: HTMLCanvasElement | undefined;
    (async () => {
      const [{ data: map }, { startViewer }] = await prepare();
      if (!map?.viewer_file)
        throw new Error("This map's file for the viewer isn't ready yet.");
      const host = canvasHostRef.current;
      if (!host || abort.signal.aborted) return;
      // Each start gets a canvas of its own: disposing a renderer loses its WebGL context for good, so a canvas
      // kept from an earlier start (the page refreshed after a staff action, say) can't be drawn on again.
      canvas = document.createElement("canvas");
      canvas.className = "absolute inset-0 size-full";
      host.prepend(canvas);
      session = await startViewer(
        canvas,
        {
          mapName: run.map,
          mapUrl: map.viewer_file.url,
          stockContentUrl: map.viewer_file.stock_content_url,
          replayUrl,
        },
        {
          onFrame: (state, timer, compared, viewed) => {
            controlsRef.current?.update(state.tick, timer);
            hudRef.current?.update(viewed, timer, compared);
            // Playback pauses itself when stepped; React hears only of that change, not of every frame.
            if (state.isPlaying !== playingRef.current) {
              playingRef.current = state.isPlaying;
              setPlaying(state.isPlaying);
            }
          },
          onCameraChange: setFreecam,
        },
        abort.signal,
      );
      if (abort.signal.aborted) {
        session.dispose();
        return;
      }
      const remembered = storedSmoothing();
      session.setInterpolation(remembered);
      setSmoothing(remembered);
      const lit = storedLighting();
      session.setFullbright(lit === "fullbright");
      setLighting(lit);
      const shown = storedOverlays();
      session.setOverlays(shown);
      setOverlays(shown);
      setPhase({ kind: "ready", session });
      playerRef.current?.focus({ preventScroll: true });

      // The deltas are an extra; without them the replay plays the same, so a failure here is only logged.
      // A run named in the address (?compare=) is compared with instead of the usual one, so a comparison can
      // be shared as a link; when it can't be, the usual one stands and settings say why.
      const against = comparisonRun(map, run);
      setUsual(against);
      const asked = parseRunId(
        new URLSearchParams(window.location.search).get(COMPARE_PARAM) ?? "",
      );
      try {
        if (asked !== null) {
          const loaded = await loadComparison(
            session,
            run,
            asked,
            abort.signal,
          );
          if (abort.signal.aborted) return;
          if (typeof loaded !== "string") {
            setComparison(loaded);
            return;
          }
          setComparing({ busy: false, problem: loaded });
        }
        if (!against) return;
        const loaded = await loadComparison(
          session,
          run,
          against.runId,
          abort.signal,
        );
        if (typeof loaded === "string") console.warn("[replay]", loaded);
        else if (!abort.signal.aborted) setComparison(loaded);
      } catch (error) {
        if (!abort.signal.aborted)
          console.warn("[replay] no comparison", error);
      }
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return;
      console.error("[replay]", error);
      setPhase({
        kind: "failed",
        message:
          error instanceof Error
            ? error.message
            : "The replay couldn't be shown.",
      });
    });
    return () => {
      abort.abort();
      session?.dispose();
      canvas?.remove();
    };
  }, [started, replayUrl, run, prepare]);

  // Next keeps a page left with Back alive but hidden, and hiding it disposes the viewer. Shown again, the page
  // starts from the route, as a fresh visit does, rather than restarting a replay nobody asked for.
  useEffect(() => () => setPhase({ kind: "poster" }), []);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const onIdle = useCallback((next: boolean) => setIdle(next), []);

  const textureCap = useTextureCapTest(
    phase.kind === "ready" ? phase.session : null,
  );

  if (!started) {
    return (
      <div id={REPLAY_ANCHOR} className="relative scroll-mt-24">
        <ReplayPoster run={run} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Button
            variant="primary"
            onClick={() => setPhase({ kind: "loading" })}
          >
            <Play />
            Watch replay
          </Button>
        </div>
      </div>
    );
  }

  const session = phase.kind === "ready" ? phase.session : null;
  const togglePlaying = () => {
    if (!session) return;
    session.setPlaying(!session.playing);
    playingRef.current = session.playing;
    setPlaying(session.playing);
  };
  const toggleFreecam = () => session?.setFreecam(!session.freecam);
  const toggleFullscreen = () => {
    // Embedded pages can be refused fullscreen; the player then stays as it is.
    if (document.fullscreenElement) void document.exitFullscreen();
    else playerRef.current?.requestFullscreen().catch(() => {});
  };
  const changeSpeed = (next: number) => {
    session?.setSpeed(next);
    setSpeed(next);
  };
  const changeSmoothing = (next: InterpolationMode) => {
    session?.setInterpolation(next);
    setSmoothing(next);
    try {
      localStorage.setItem(SMOOTHING_KEY, next);
    } catch {
      // Not remembered; it still applies to this replay.
    }
  };

  const changeOverlays = (next: Overlays) => {
    session?.setOverlays(next);
    setOverlays(next);
    storeOverlays(next);
  };
  const changeComparison = async (runId: number) => {
    if (!session) return;
    compareAbort.current?.abort();
    const abort = new AbortController();
    compareAbort.current = abort;
    setComparing({ busy: true, problem: null });
    try {
      const loaded = await loadComparison(session, run, runId, abort.signal);
      if (abort.signal.aborted) return;
      if (typeof loaded === "string") {
        setComparing({ busy: false, problem: loaded });
        return;
      }
      setComparison(loaded);
      setComparing({ busy: false, problem: null });
      showInAddress(loaded.runId === usual?.runId ? null : loaded.runId);
    } catch {
      if (!abort.signal.aborted)
        setComparing({
          busy: false,
          problem: "Its replay couldn't be loaded. Try again.",
        });
    }
  };

  const changeFollow = (next: Follow) => {
    session?.setFollow(next);
    setFollow(next);
  };

  const changeLighting = (next: Lighting) => {
    session?.setFullbright(next === "fullbright");
    setLighting(next);
    storeLighting(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!session || event.altKey) return;
    if (textureCap.onKey(event)) {
      event.preventDefault();
      return;
    }
    // A focused button already answers Space and Enter with a click.
    const onButton = (event.target as HTMLElement).closest("button");
    const stride =
      event.ctrlKey || event.metaKey ? 100 : event.shiftKey ? 10 : 1;
    const actions: Record<string, () => void> = {
      " ": togglePlaying,
      ArrowLeft: () => session.step(-stride),
      ArrowRight: () => session.step(stride),
      Home: () => session.seek(session.runStart),
      End: () => session.seek(session.runEnd),
      x: toggleFreecam,
      // Only reaches the page when the mouse wasn't captured; a capture's Escape goes to the browser.
      Escape: () => session.setFreecam(false),
      f: toggleFullscreen,
    };
    const action =
      actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action || (onButton && event.key === " ")) return;
    if (event.key === "Escape" && !session.freecam) return;
    if (event.key.length === 1 && (event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    action();
  };

  const canFullscreen = document.fullscreenEnabled;
  return (
    <div
      ref={playerRef}
      id={REPLAY_ANCHOR}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={classNames(
        "bg-bg @container relative w-full scroll-mt-24 overflow-hidden outline-none",
        fullscreen ? "h-full" : "border-border aspect-video rounded-lg border",
        idle && "cursor-none",
      )}
    >
      <div
        ref={canvasHostRef}
        className="absolute inset-0"
        onClick={() => {
          if (!freecam) togglePlaying();
        }}
      />
      {phase.kind === "loading" && (
        <div className="text-text-muted absolute inset-0 flex items-center justify-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading the map
        </div>
      )}
      {phase.kind === "failed" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm">
          {phase.message}
        </div>
      )}
      {freecam && (
        <div className="motion-enter pointer-events-none absolute top-3 left-3 flex items-center gap-2 text-xs">
          <Badge tone="accent">Freecam</Badge>
          <span className="bg-bg/80 text-text-muted rounded-sm px-1.5 py-0.5">
            WASD to fly, Shift to go faster, Esc to leave
          </span>
        </div>
      )}
      {textureCap.label}
      {session && <ReplayHud ref={hudRef} barShown={!idle} />}
      {session && comparison && (
        <ComparisonLegend
          run={run}
          comparison={comparison}
          styleNames={styleNames}
          follow={follow}
          onFollow={changeFollow}
        />
      )}
      {session && (
        <ReplayControls
          ref={controlsRef}
          session={session}
          runTime={run.time}
          container={playerRef}
          playing={playing}
          freecam={freecam}
          fullscreen={canFullscreen ? fullscreen : null}
          speed={speed}
          interpolation={smoothing}
          lighting={lighting}
          comparison={comparison}
          usual={usual}
          comparing={comparing}
          styleNames={styleNames}
          overlays={overlays}
          onComparison={changeComparison}
          onOverlays={changeOverlays}
          onTogglePlaying={togglePlaying}
          onToggleFreecam={toggleFreecam}
          onToggleFullscreen={toggleFullscreen}
          onSpeed={changeSpeed}
          onInterpolation={changeSmoothing}
          onLighting={changeLighting}
          onIdle={onIdle}
        />
      )}
    </div>
  );
}

/** The address's parameter naming the run compared with: `/runs/1650?compare=1652#replay`. */
const COMPARE_PARAM = "compare";

/** Puts the compared run in the address, or takes it out for the usual one, without a navigation. */
function showInAddress(runId: number | null) {
  const url = new URL(window.location.href);
  if (runId === null) url.searchParams.delete(COMPARE_PARAM);
  else url.searchParams.set(COMPARE_PARAM, String(runId));
  // The router's own state is kept, so back and forward still work as before.
  window.history.replaceState(window.history.state, "", url);
}

/** Loads another run's replay to compare `run` with, or says why it can't be. */
async function loadComparison(
  session: ViewerSession,
  run: Schemas["RunDetail"],
  runId: number,
  signal: AbortSignal,
): Promise<ComparisonRun | string> {
  const found = await findComparison(run, runId, signal);
  if (typeof found === "string") return found;
  await session.compareWith(found.replayUrl, signal);
  return found.comparison;
}
