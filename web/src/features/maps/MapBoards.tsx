"use client";
// A map page's style, track and view menus, and what they show: the leaderboard, with the world record and the
// board's players and runs beside the menus, then the WR history. Every style and track's 2.0 board arrives with the page, so switching them
// happens in place; the normal style's pre-2.0 leaderboards load when chosen. The record and its history are
// 2.0's in every view; the players and runs follow the view.
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Schemas } from "@/api/client";
import { RunLink } from "@/features/runs/RunLink";
import {
  LEGACY_STYLE,
  type View,
  ViewMenu,
  viewFrom,
} from "@/features/legacy/views";
import { formatTime, trackName } from "@/features/runs/time";
import { Card, Label } from "@/ui/Card";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { classNames } from "@/ui/classNames";
import { TierBadge } from "@/ui/TierBadge";
import { Leaderboard } from "./Leaderboard";
import { WrHistoryChart } from "./WrHistoryChart";

export function MapBoards({
  map,
  styleOrder,
  styleNames,
  me,
}: {
  map: Schemas["MapDetail"];
  /** Style keys in the ruleset's order. */
  styleOrder: string[];
  styleNames: Record<string, string>;
  me: string | undefined;
}) {
  const params = useSearchParams();
  // The banner's slot for the figures on a phone (MapHeader), found once the page is in the browser.
  const bannerSlot = useSyncExternalStore(
    noChanges,
    () => document.getElementById("map-banner-figures"),
    () => null,
  );
  const hasLegacy = map.legacy_players > 0;
  if (map.tracks.length === 0 && !hasLegacy) {
    return (
      <Card className="text-text-muted">
        Nobody has finished this map yet. Times show here once a run is finished
        on a SourceJump server.
      </Card>
    );
  }
  // The same choices on every map (lead, 2026-10-26): every ranked style, and the main track beside any
  // bonuses. Boards nobody has run yet are dimmed, and say so when chosen.
  const tracks = [...new Set([0, ...map.tracks.map((t) => t.track)])].sort(
    (a, b) => a - b,
  );
  const requestedTrack = Number(params.get("track") ?? 0);
  const trackNumber = tracks.includes(requestedTrack) ? requestedTrack : 0;
  const track = map.tracks.find((t) => t.track === trackNumber);
  const retired = map.tracks.flatMap((t) =>
    t.styles.map((s) => s.style).filter((key) => !styleOrder.includes(key)),
  );
  const styleKeys = [...new Set([...styleOrder, ...retired])];
  const hasRuns = (key: string) =>
    (track?.styles.some((s) => s.style === key) ?? false) ||
    (key === LEGACY_STYLE && trackNumber === 0 && hasLegacy);
  const styleKey =
    styleKeys.find((key) => key === params.get("style")) ??
    styleKeys.find(hasRuns) ??
    styleKeys[0];
  if (!styleKey) return null;
  const board = track?.styles.find((s) => s.style === styleKey);
  const onLegacyBoard =
    hasLegacy && styleKey === LEGACY_STYLE && trackNumber === 0;
  // 2.0 first (lead, 2026-10-26); a board with no 2.0 runs yet opens on its pre-2.0 runs instead of nothing.
  const view: View = onLegacyBoard
    ? viewFrom(params.get("view"), board ? "current" : "legacy")
    : "current";
  const name = (key: string) => styleNames[key] ?? key;
  const totals = boardTotals(map, board, view);

  // The choice lives in the address, so a view can be shared, but changing it doesn't load a page.
  function choose(choice: { style?: string; track?: number; view?: View }) {
    const url = new URL(window.location.href);
    const nextTrack = choice.track ?? trackNumber;
    const nextStyle = choice.style ?? styleKey;
    if (nextStyle) url.searchParams.set("style", nextStyle);
    if (nextTrack === 0) url.searchParams.delete("track");
    else url.searchParams.set("track", String(nextTrack));
    if (choice.view) url.searchParams.set("view", choice.view);
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }

  const history =
    // The Pre-2.0 view shows the old site's records instead; the two histories are never mixed.
    view === "legacy" ? (
      <HistoryCard
        label="Pre-2.0 record history"
        records={map.legacy_record_history}
        end={map.legacy_last_run_at ?? undefined}
        legacy
      />
    ) : (
      board && (
        <HistoryCard
          label="WR history"
          records={board.wr_history}
          end={map.last_run_at ?? undefined}
        />
      )
    );

  // The board comes first, so it starts within the first screen; the record and totals sit on the choices' line,
  // and the history follows the board.
  // The choices sit close to the board they pick; the history, a separate thing, stands a step further off.
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <ChoiceBar>
            <ChoiceMenu
              label="Style"
              options={styleKeys.map((key) => ({
                value: key,
                label: name(key),
                quiet: !hasRuns(key),
              }))}
              value={styleKey}
              onChange={(style) => choose({ style })}
            />
            <ChoiceMenu
              label="Track"
              options={tracks.map((t) => ({
                value: String(t),
                label: trackName(t),
                quiet: !map.tracks.some((known) => known.track === t),
              }))}
              value={String(trackNumber)}
              onChange={(value) => choose({ track: Number(value) })}
            />
            <ViewMenu
              value={view}
              available={onLegacyBoard}
              onChange={(next) => choose({ view: next })}
            />
            {track &&
              track.track > 0 &&
              track.tier != null &&
              map.tier_count != null && (
                <TierBadge tier={track.tier} tierCount={map.tier_count} />
              )}
          </ChoiceBar>
          <Figures
            board={board}
            totals={totals}
            className={classNames(bannerSlot && "max-lg:hidden")}
          />
          {bannerSlot &&
            createPortal(
              <Figures board={board} totals={totals} compact />,
              bannerSlot,
            )}
        </div>

        {view === "current" && !board ? (
          <Card className="text-text-muted">
            Nobody has a {name(styleKey)} run on{" "}
            {trackNumber === 0 ? "the main track" : trackName(trackNumber)} yet.
            {onLegacyBoard && " Its pre-2.0 runs are under Runs."}
          </Card>
        ) : (
          <Leaderboard
            key={`${styleKey}-${trackNumber}-${view}`}
            map={map.name}
            style={styleKey}
            track={trackNumber}
            view={view}
            first={
              view === "current" && board
                ? {
                    entries: board.leaderboard,
                    next_cursor: board.next_cursor,
                    total: board.players,
                    world_record_time: board.world_record.time,
                    fastest_time: board.world_record.time,
                  }
                : undefined
            }
            me={me}
          />
        )}
      </div>

      {history && <div className="mt-2">{history}</div>}
    </>
  );
}

const number = new Intl.NumberFormat("en");

/** The banner slot never changes once the page is drawn, so there's nothing to subscribe to. */
function noChanges() {
  return () => {};
}

/** The chosen board's world record, players and runs: on the choices' line, or (compact) on the banner. */
function Figures({
  board,
  totals,
  compact = false,
  className,
}: {
  board: Schemas["MapStyle"] | undefined;
  totals: { players: number; runs: number };
  compact?: boolean;
  className?: string;
}) {
  const figure = compact ? "font-bold" : "text-lg font-bold";
  return (
    <dl
      className={classNames(
        "text-text-muted flex flex-wrap items-baseline gap-y-1 text-sm",
        compact ? "gap-x-3" : "gap-x-5",
        className,
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <dt>World record</dt>
        <dd className={classNames(figure, "tabular-nums")}>
          {board ? (
            <RunLink
              runId={board.world_record.run_id}
              className="text-accent underline-offset-4 hover:underline"
            >
              {formatTime(board.world_record.time)}
            </RunLink>
          ) : (
            <span className="text-text-subtle">–</span>
          )}
        </dd>
      </div>
      <Total label="players" value={totals.players} figure={figure} />
      <Total label="runs" value={totals.runs} figure={figure} />
    </dl>
  );
}

/** A count on the choices' line, the number first: "69 players". */
function Total({
  label,
  value,
  figure,
}: {
  label: string;
  value: number;
  figure: string;
}) {
  return (
    <div className="flex flex-row-reverse items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className={classNames("text-text tabular-nums", figure)}>
        {number.format(value)}
      </dd>
    </div>
  );
}

/** The players and runs of the board and view shown. Pre-2.0 runs count only in the views that show them. */
function boardTotals(
  map: Schemas["MapDetail"],
  board: Schemas["MapStyle"] | undefined,
  view: View,
): { players: number; runs: number } {
  const current = { players: board?.players ?? 0, runs: board?.runs ?? 0 };
  switch (view) {
    case "current":
      return current;
    case "legacy":
      return { players: map.legacy_players, runs: map.legacy_runs };
    case "all":
      return {
        players: map.all_players,
        runs: current.runs + map.legacy_runs,
      };
  }
}

function HistoryCard({
  label,
  records,
  end,
  legacy = false,
}: {
  label: string;
  records: Schemas["WrHistoryEntry"][];
  end?: string;
  legacy?: boolean;
}) {
  if (records.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <Label>{label}</Label>
        <span className="text-text-muted text-sm">
          {records.length === 1 ? "1 record" : `${records.length} records`}
        </span>
      </div>
      <WrHistoryChart records={records} end={end} legacy={legacy} />
    </Card>
  );
}
