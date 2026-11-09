"use client";
// The zone editor (mockup C): the map in 3D with zones drawn over it, placed the way shavit's in-game zone menu
// places them — a corner, the opposite corner, the height, and a point for teleports and spawns. It draws every
// type shavit's menu offers (`zoneKinds.ts`), one track at a time. The result is published as the map's next
// zone set. Without editing, it is the map's public zone viewer: the same view with every way to change a zone
// left out.
import { LoaderCircle, Maximize, Minimize, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { api, type Schemas } from "@/api/client";
import {
  type Lighting,
  LIGHTING_OPTIONS,
  storedLighting,
  storeLighting,
} from "@/features/replays/lighting";
import { useTextureCapTest } from "@/features/replays/textureCapTest";
import { trackName } from "@/features/runs/time";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { Menu, MenuItem } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { useStaffAction } from "../useStaffAction";
import type { ZoneEditorSession } from "./zoneEditorSession";
import {
  adjustHeight,
  GRIDS,
  place,
  type Placed,
  type Placing,
  type Point,
  previewBox,
  withZone,
  zoneBox,
} from "./zoneTool";
import {
  decodeValue,
  encodeValue,
  missingValues,
  ZONE_KINDS,
  type ZoneValue,
  zoneKind,
} from "./zoneKinds";
import { type Zone, zoneChanges } from "./zones";

/** A zone being drawn: a new one, or one being redrawn in place. */
interface Adding {
  type: string;
  track: number;
  replacing: Zone | null;
}

interface State {
  zones: Zone[];
  selected: Zone | null;
  adding: Adding | null;
  placing: Placing;
  /** The last corner was refused: in line with the first, it would make a box with no floor. */
  refused: boolean;
}

type Action =
  | { kind: "add"; adding: Adding }
  | { kind: "place"; point: Point }
  | { kind: "height"; steps: number; grid: number }
  | { kind: "keep" }
  | { kind: "cancel" }
  | { kind: "select"; zone: Zone | null }
  | { kind: "remove"; zone: Zone }
  | { kind: "value"; zone: Zone; data: number | undefined }
  | { kind: "reset"; zones: Zone[] };

const IDLE: Placing = { step: "first" };
const LAST_TRACK = 8;

/** The set with the zone being drawn finished as placed, and that zone picked. */
function finish(state: State, placed: Placed): State {
  if (!state.adding) return state;
  const { type, track, replacing } = state.adding;
  const initial = zoneKind(type).value?.initial;
  const zones = withZone(
    state.zones,
    type,
    track,
    placed,
    replacing,
    initial ? initial(state.zones, track) : undefined,
  );
  // The zone just drawn: in place of the one redrawn, or last when it's new.
  const drawn = replacing
    ? zones[state.zones.indexOf(replacing)]!
    : zones[zones.length - 1]!;
  return {
    zones,
    selected: drawn,
    adding: null,
    placing: IDLE,
    refused: false,
  };
}

function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case "add":
      return {
        ...state,
        adding: action.adding,
        // A spawn is only a point.
        placing:
          zoneKind(action.adding.type).shape === "point"
            ? { step: "point", box: null }
            : IDLE,
        refused: false,
      };
    case "place": {
      if (!state.adding) return state;
      // Clicking again once the height is being set keeps the box, as Enter does.
      if (state.placing.step === "height")
        return reduce(state, { kind: "keep" });
      if (state.placing.step === "point")
        return finish(state, { box: state.placing.box, point: action.point });
      const next = place(state.placing, action.point);
      return next
        ? { ...state, placing: next, refused: false }
        : { ...state, refused: true };
    }
    case "height":
      return {
        ...state,
        placing: adjustHeight(state.placing, action.steps, action.grid),
      };
    case "keep": {
      const box = previewBox(state.placing, null);
      if (!state.adding || state.placing.step !== "height" || !box)
        return state;
      // A teleport's box is kept while the point it sends players to is placed.
      if (zoneKind(state.adding.type).shape === "box-destination")
        return { ...state, placing: { step: "point", box }, refused: false };
      return finish(state, { box, point: null });
    }
    case "cancel":
      return { ...state, adding: null, placing: IDLE, refused: false };
    case "select":
      return { ...state, selected: action.zone };
    case "remove":
      return {
        ...state,
        zones: state.zones.filter((zone) => zone !== action.zone),
        selected: null,
      };
    case "value": {
      // A cleared value leaves the field out, as shavit's own files do.
      const changed: Zone = { ...action.zone, data: action.data };
      if (action.data === undefined) delete changed.data;
      return {
        ...state,
        zones: state.zones.map((zone) =>
          zone === action.zone ? changed : zone,
        ),
        selected: state.selected === action.zone ? changed : state.selected,
      };
    }
    case "reset":
      return {
        zones: action.zones,
        selected: null,
        adding: null,
        placing: IDLE,
        refused: false,
      };
  }
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; session: ZoneEditorSession }
  | { kind: "failed"; message: string };

/** What an edit is published on top of: the version in force, or null for a map's first zone set. */
interface Editing {
  basedOn: number | null;
}

export function ZoneEditor({
  map,
  zones: initial,
  edit,
  viewerFile,
  tracks,
}: {
  map: string;
  /** The zone set in force, which the editor starts from. */
  zones: Zone[];
  /** Null shows the zones without any way to change them. */
  edit: Editing | null;
  viewerFile: Schemas["ViewerFile"];
  /** Tracks the map has, so bonuses can be zoned; one more is offered while editing. */
  tracks: number[];
}) {
  const [state, dispatch] = useReducer(reduce, {
    zones: initial,
    selected: null,
    adding: null,
    placing: IDLE,
    refused: false,
  });
  const [grid, setGrid] = useState(16);
  const [track, setTrack] = useState(0);
  const [lighting, setLighting] = useState<Lighting>("lit");
  const [fullscreen, setFullscreen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [reviewing, setReviewing] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  // The wheel's height steps are in the grid's units; the session's handlers are made once, so they read it here.
  const gridRef = useRef(grid);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    const abort = new AbortController();
    let session: ZoneEditorSession | undefined;
    let canvas: HTMLCanvasElement | undefined;
    (async () => {
      const { startZoneEditor } = await import("./zoneEditorSession");
      const view = viewRef.current;
      if (!view || abort.signal.aborted) return;
      // Each session gets a canvas of its own: disposing a renderer loses its WebGL context for good, and a
      // canvas React kept across a remount or a navigation would hand the next session that dead context.
      canvas = document.createElement("canvas");
      canvas.className = "absolute inset-0 size-full";
      view.prepend(canvas);
      session = await startZoneEditor(
        canvas,
        {
          mapName: map,
          mapUrl: viewerFile.url,
          stockContentUrl: viewerFile.stock_content_url,
        },
        {
          onPlace: (point) => dispatch({ kind: "place", point }),
          onHeight: (steps) =>
            dispatch({ kind: "height", steps, grid: gridRef.current }),
        },
        abort.signal,
      );
      if (abort.signal.aborted) {
        session.dispose();
        return;
      }
      const lit = storedLighting();
      session.setFullbright(lit === "fullbright");
      setLighting(lit);
      setPhase({ kind: "ready", session });
      // The map's header sits above the editor; the whole view should be on screen to work in it.
      viewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      viewRef.current?.focus({ preventScroll: true });
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return;
      console.error("[zones]", error);
      setPhase({
        kind: "failed",
        message:
          error instanceof Error ? error.message : "The map couldn't be shown.",
      });
    });
    return () => {
      abort.abort();
      session?.dispose();
      canvas?.remove();
    };
  }, [map, viewerFile]);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === viewRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const session = phase.kind === "ready" ? phase.session : null;
  const textureCap = useTextureCapTest(session);
  useEffect(() => {
    session?.setScene({ ...state, drawing: state.adding !== null, grid });
  }, [session, state, grid]);

  const select = (zone: Zone) => {
    dispatch({ kind: "select", zone });
    session?.lookAt(zone);
    viewRef.current?.focus({ preventScroll: true });
  };
  const startAdding = (adding: Adding) => dispatch({ kind: "add", adding });
  // Drawing is done with the mouse and keys over the view, so it takes focus as a zone starts.
  useEffect(() => {
    if (state.adding) viewRef.current?.focus({ preventScroll: true });
  }, [state.adding]);

  const changeLighting = (next: Lighting) => {
    session?.setFullbright(next === "fullbright");
    setLighting(next);
    storeLighting(next);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else viewRef.current?.requestFullscreen().catch(() => {});
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Typing a value in the panel isn't a command.
    if ((event.target as HTMLElement).closest("input")) return;
    if (textureCap.onKey(event)) event.preventDefault();
    else if (!edit) return;
    else if (event.key === "Escape") dispatch({ kind: "cancel" });
    else if (event.key === "Enter") dispatch({ kind: "keep" });
    else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      state.selected &&
      !state.adding
    )
      dispatch({ kind: "remove", zone: state.selected });
    else return;
    event.preventDefault();
  };

  const changes = zoneChanges(initial, state.zones);
  // Bonuses drawn in this session count too, so the next one is offered without reloading.
  const trackList = [
    ...new Set([0, ...tracks, ...state.zones.map((zone) => zone.track)]),
  ].sort((a, b) => a - b);
  // shavit has bonuses 1 to 8 (`Track_Bonus_Last`), so a ninth is never offered.
  const nextBonus = Math.max(...trackList) + 1;
  const offered =
    edit && nextBonus <= LAST_TRACK ? [...trackList, nextBonus] : trackList;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={viewRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={classNames(
          "bg-bg relative w-full overflow-hidden outline-none",
          fullscreen
            ? "h-full"
            : "border-border aspect-video rounded-md border",
          state.adding && "cursor-crosshair",
        )}
      >
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
        {textureCap.label}
        {session && (
          <>
            {edit ? (
              <Steps
                adding={state.adding}
                placing={state.placing}
                refused={state.refused}
              />
            ) : (
              <div
                className={classNames(
                  PANEL,
                  "text-text-subtle top-3 left-3 max-w-64 text-xs",
                )}
              >
                {MOVING}
              </div>
            )}
            <ZoneList
              zones={state.zones.filter((zone) => zone.track === track)}
              selected={state.selected}
              adding={state.adding}
              track={track}
              tracks={offered}
              onTrack={(next) => {
                setTrack(next);
                dispatch({ kind: "select", zone: null });
              }}
              onSelect={select}
              editing={
                edit && {
                  onRedraw: (zone) =>
                    startAdding({
                      type: zone.type,
                      track: zone.track,
                      replacing: zone,
                    }),
                  onRemove: (zone) => dispatch({ kind: "remove", zone }),
                  onValue: (zone, data) =>
                    dispatch({ kind: "value", zone, data }),
                }
              }
              addMenu={
                edit && (
                  <Menu
                    label={`Add a zone to ${trackName(track).toLowerCase()}`}
                    align="end"
                    triggerClassName="border-border-strong text-text hover:bg-surface-raised flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors duration-(--duration-fast)"
                    trigger={
                      <>
                        <Plus aria-hidden className="size-4" />
                        Add zone
                      </>
                    }
                  >
                    {ZONE_KINDS.map((kind) => (
                      <MenuItem
                        key={kind.type}
                        onClick={() =>
                          startAdding({
                            type: kind.type,
                            track,
                            replacing: null,
                          })
                        }
                      >
                        {kind.label}
                      </MenuItem>
                    ))}
                  </Menu>
                )
              }
            />
            <div
              className={classNames(
                PANEL,
                "bottom-3 left-3 flex flex-wrap items-center gap-3 text-xs",
              )}
            >
              {edit && (
                <Segmented
                  label="Grid"
                  value={String(grid)}
                  onChange={(value) => setGrid(Number(value))}
                  options={GRIDS.map((size) => ({
                    value: String(size),
                    label: String(size),
                  }))}
                />
              )}
              <Segmented
                label="Lighting"
                value={lighting}
                onChange={(value) => changeLighting(value as Lighting)}
                options={LIGHTING_OPTIONS}
              />
              {document.fullscreenEnabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  onClick={toggleFullscreen}
                  className="px-1.5"
                >
                  {fullscreen ? (
                    <Minimize aria-hidden />
                  ) : (
                    <Maximize aria-hidden />
                  )}
                </Button>
              )}
            </div>
            {edit && (
              <div
                className={classNames(
                  PANEL,
                  "right-3 bottom-3 flex items-center gap-2",
                )}
              >
                <span className="text-text-muted text-xs">
                  {changes.length === 0
                    ? "No changes"
                    : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
                </span>
                {changes.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dispatch({ kind: "reset", zones: initial })}
                  >
                    Discard
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={changes.length === 0}
                  onClick={() => setReviewing(true)}
                >
                  Review and publish
                </Button>
              </div>
            )}
          </>
        )}
        {edit && (
          <Publish
            map={map}
            basedOn={edit.basedOn}
            zones={state.zones}
            changes={changes}
            open={reviewing}
            onClose={() => setReviewing(false)}
          />
        )}
      </div>
    </div>
  );
}

const PANEL =
  "bg-bg/80 border-text/10 absolute rounded-md border p-3 text-sm backdrop-blur-xs";

const MOVING =
  "WASD to fly, Q and E down and up, right-drag to look, wheel to move.";

/** The steps for each shape: a box, a box and where it sends players, or a point alone. */
const BOX_STEPS = [
  "Click a corner on the floor",
  "Click the opposite corner",
  "Scroll to set the height, then click or press Enter",
];
const STEPS = {
  box: BOX_STEPS,
  "box-destination": [...BOX_STEPS, "Click where it sends players"],
  point: ["Click where players spawn"],
};

/** What to do next while a zone is being drawn. */
function Steps({
  adding,
  placing,
  refused,
}: {
  adding: Adding | null;
  placing: Placing;
  refused: boolean;
}) {
  if (!adding) {
    return (
      <div
        className={classNames(
          PANEL,
          "text-text-muted top-3 left-3 flex max-w-64 flex-col gap-1.5",
        )}
      >
        <p>Pick a zone to see it or redraw it, or add one.</p>
        <p className="text-text-subtle text-xs">{MOVING}</p>
      </div>
    );
  }
  const kind = zoneKind(adding.type);
  const steps = STEPS[kind.shape];
  const current =
    placing.step === "point"
      ? steps.length - 1
      : ["first", "second", "height"].indexOf(placing.step);
  return (
    <div className={classNames(PANEL, "motion-enter top-3 left-3 w-72")}>
      <p className="text-text-subtle mb-1.5 text-xs font-bold tracking-wide uppercase">
        {adding.replacing ? "Redraw" : "New"} {kind.label} ·{" "}
        {trackName(adding.track)}
      </p>
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index === current ? "text-text" : "text-text-subtle"}
          >
            {step}
            {index < current && (
              <span className="text-text-subtle"> · done</span>
            )}
          </li>
        ))}
      </ol>
      {refused && (
        <p className="text-warning motion-enter mt-2 text-xs">
          That corner lines up with the first one, so the box would have no
          floor. Pick one further away on both sides.
        </p>
      )}
      <p className="text-text-subtle mt-2 text-xs">Esc cancels</p>
    </div>
  );
}

const SWATCH: Record<string, string> = {
  start: "bg-success",
  end: "bg-danger",
};

/** Changing a picked zone, for the editor only. */
interface ZoneEdits {
  onRedraw: (zone: Zone) => void;
  onRemove: (zone: Zone) => void;
  onValue: (zone: Zone, data: number | undefined) => void;
}

/** One track's zones, picked with the track switch above them. Picking one shows it; while editing, a picked
 * zone can also be redrawn, deleted, or have its value set. */
function ZoneList({
  zones,
  selected,
  adding,
  track,
  tracks,
  onTrack,
  onSelect,
  editing,
  addMenu,
}: {
  zones: Zone[];
  selected: Zone | null;
  adding: Adding | null;
  track: number;
  tracks: number[];
  onTrack: (track: number) => void;
  onSelect: (zone: Zone) => void;
  editing: ZoneEdits | null;
  addMenu: ReactNode;
}) {
  return (
    <div
      className={classNames(
        PANEL,
        "top-3 right-3 flex max-h-3/4 w-64 flex-col gap-2 overflow-y-auto",
      )}
    >
      <Segmented
        label="Track"
        value={String(track)}
        onChange={(value) => onTrack(Number(value))}
        options={tracks.map((value) => ({
          value: String(value),
          label: value === 0 ? "Main" : `B${value}`,
        }))}
      />
      <p className="text-text-subtle text-xs font-bold tracking-wide uppercase">
        {trackName(track)}
      </p>
      {zones.length === 0 && (
        <p className="text-text-muted text-xs">No zones on this track yet.</p>
      )}
      <div className="flex flex-col gap-0.5">
        {zones.map((zone) => {
          const kind = zoneKind(zone.type);
          const isSelected = zone === selected;
          const drawing = adding?.replacing === zone;
          return (
            <div key={`${zone.type}/${zone.id}`} className="flex flex-col">
              <button
                type="button"
                onClick={() => onSelect(zone)}
                disabled={!zoneBox(zone) && !zone.dest}
                className={classNames(
                  "flex items-center gap-2 rounded-sm px-2 py-1 text-left",
                  isSelected
                    ? "bg-accent-soft outline-accent outline"
                    : "hover:bg-text/5",
                )}
              >
                <span
                  aria-hidden
                  className={classNames(
                    "size-2.5 shrink-0 rounded-xs",
                    SWATCH[zone.type] ?? "bg-warning",
                  )}
                />
                {kind.label}
                {kind.value && zone.data != null && (
                  <span className="text-text-muted tabular-nums">
                    {decodeValue(zone.data, kind.value.decimal)}
                  </span>
                )}
                {drawing && (
                  <span className="text-text-subtle ml-auto text-xs">
                    drawing
                  </span>
                )}
              </button>
              {editing && isSelected && !adding && (
                <div className="motion-enter flex flex-col gap-1.5 pt-1 pl-6">
                  {kind.value && (
                    <ValueField
                      key={zone.id}
                      zone={zone}
                      value={kind.value}
                      onChange={(data) => editing.onValue(zone, data)}
                    />
                  )}
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => editing.onRedraw(zone)}
                    >
                      Redraw
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => editing.onRemove(zone)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {addMenu && <div className="self-start">{addMenu}</div>}
    </div>
  );
}

/** A zone's value, as typed; cleared, the zone has none and can't be published. */
function ValueField({
  zone,
  value,
  onChange,
}: {
  zone: Zone;
  value: ZoneValue;
  onChange: (data: number | undefined) => void;
}) {
  const [text, setText] = useState(
    zone.data == null ? "" : String(decodeValue(zone.data, value.decimal)),
  );
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-text-muted">{value.label}</span>
      <Input
        inputMode={value.decimal ? "decimal" : "numeric"}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const number = Number(event.target.value);
          onChange(
            event.target.value.trim() === "" || !Number.isFinite(number)
              ? undefined
              : encodeValue(number, value.decimal),
          );
        }}
      />
      <span className="text-text-subtle">{value.hint}</span>
    </label>
  );
}

/** What publishing changes, a note for the staff log, and the publish itself. */
function Publish({
  map,
  basedOn,
  zones,
  changes,
  open,
  onClose,
}: {
  map: string;
  basedOn: number | null;
  zones: Zone[];
  changes: string[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const action = useStaffAction();
  const [note, setNote] = useState("");
  const complete = ["start", "end"].every((type) =>
    zones.some((zone) => zone.type === type && zone.track === 0),
  );
  const missing = missingValues(zones);
  const version = (basedOn ?? 0) + 1;

  async function publish() {
    const done = await action.run(
      () =>
        api.POST("/v1/staff/maps/{map}/zones", {
          params: { path: { map } },
          body: { based_on: basedOn, zones, note },
        }),
      "The zones couldn't be published. Try again.",
    );
    if (done) router.push(`/maps/${encodeURIComponent(map)}/manage`);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Publish version ${version}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep editing
          </Button>
          <Button
            variant="primary"
            disabled={
              !complete || missing.length > 0 || !note.trim() || action.busy
            }
            onClick={publish}
          >
            {action.busy ? "Publishing…" : `Publish version ${version}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">
          Servers load the new set on their next map start.
        </p>
        <ul className="text-text-muted flex list-disc flex-col gap-0.5 pl-5">
          {/* Two zones of one type on one track read the same, so the list is keyed by place. */}
          {changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
        {!complete && (
          <p className="text-warning">
            The main track needs a start and an end zone.
          </p>
        )}
        {missing.map((problem) => (
          <p key={problem} className="text-warning">
            {problem}
          </p>
        ))}
        <Input
          data-autofocus
          aria-label="What changed and why"
          placeholder="What changed and why, for the staff log"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
        />
        {action.error && <p className="text-danger">{action.error}</p>}
      </div>
    </Dialog>
  );
}
