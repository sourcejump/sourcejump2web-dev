"use client";
// Every valid run a player has on one map, style and track, fastest first, with how far each is from their
// personal best, where it was set and a link to its run page. Opened from a personal best's run count, which
// starts loading the runs as the pointer reaches it, so they are usually there by the click.
import { type CSSProperties, useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import {
  formatDate,
  formatGap,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { Dialog } from "@/ui/Dialog";
import { DividedList } from "@/ui/Divided";
import { Link } from "@/ui/Link";

export type RunsDialogBoard = {
  map: string;
  style: string;
  styleName: string;
  track: number;
  /** Their valid runs there, as the personal best counts them: the dialog opens at the height they take. */
  runs: number;
};

/** The endpoint's default page. */
const SHOWN_RUNS = 50;
/** How long a loaded list is reused: long enough to cover hovering and then clicking, short enough that a run
 * finished meanwhile shows on a later opening. */
const REUSE_MS = 60_000;
const loaded = new Map<
  string,
  { at: number; page: Promise<Schemas["PlayerRunPage"] | undefined> }
>();

/** The board's runs, loaded once for a hover and the click after it. A failure isn't kept, so opening retries. */
export function loadRuns(
  steamid64: string,
  board: RunsDialogBoard,
): Promise<Schemas["PlayerRunPage"] | undefined> {
  const key = [steamid64, board.map, board.style, board.track].join(" ");
  const kept = loaded.get(key);
  if (kept && Date.now() - kept.at < REUSE_MS) return kept.page;
  const page = api
    .GET("/v1/players/{player}/runs", {
      params: {
        path: { player: steamid64 },
        query: { map: board.map, style: board.style, track: board.track },
      },
    })
    .then((result) => result.data)
    .catch(() => undefined)
    .then((data) => {
      if (!data) loaded.delete(key);
      return data;
    });
  loaded.set(key, { at: Date.now(), page });
  return page;
}

/** A run's row; the placeholders while loading share its height. */
const ROW = "flex h-10 items-center gap-4 text-sm";

export function RunsDialog({
  steamid64,
  board,
  onClose,
}: {
  steamid64: string;
  /** The board whose runs to show; none keeps the dialog closed. */
  board: RunsDialogBoard | undefined;
  onClose: () => void;
}) {
  // The last board shown stays while the dialog closes, so its content doesn't vanish mid-fade.
  const [shown, setShown] = useState(board);
  const [page, setPage] = useState<Schemas["PlayerRunPage"]>();
  const [failed, setFailed] = useState(false);
  if (board && board !== shown) {
    setShown(board);
    setPage(undefined);
    setFailed(false);
  }

  useEffect(() => {
    if (!board) return;
    let current = true;
    void loadRuns(steamid64, board).then((data) => {
      if (!current) return;
      if (data) setPage(data);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [board, steamid64]);

  const best = page?.runs[0]?.time;
  const total = page?.total ?? shown?.runs ?? 0;
  const listed = page?.runs.length ?? Math.min(total, SHOWN_RUNS);
  return (
    <Dialog
      open={board !== undefined}
      onClose={onClose}
      title={
        shown && (
          <span className="flex flex-col">
            {shown.map}
            <span className="text-text-muted text-sm font-normal">
              {shown.styleName} · {trackName(shown.track)} · {total}{" "}
              {total === 1 ? "run" : "runs"}
            </span>
          </span>
        )
      }
      footer={
        <p className="text-text-muted text-xs">
          {total > listed
            ? `The fastest ${listed} of ${total} valid runs. `
            : "Every valid 2.0 run, fastest first. "}
          Only the personal best places on the leaderboard.
        </p>
      }
    >
      {failed ? (
        <p className="text-danger text-sm">
          These runs couldn&apos;t be loaded. Try again.
        </p>
      ) : !page ? (
        // Rows of the same height hold the list's place, so the dialog doesn't grow when the runs arrive.
        <DividedList as="ol" aria-busy>
          {Array.from({ length: listed }, (_, index) => (
            <li key={index} className={ROW}>
              <span className="bg-surface-raised h-3 w-16 rounded-sm" />
              <span className="bg-surface-raised h-3 w-12 rounded-sm" />
              <span className="bg-surface-raised h-3 w-32 rounded-sm" />
            </li>
          ))}
        </DividedList>
      ) : (
        <DividedList as="ol">
          {page.runs.map((run, index) => (
            <li
              key={run.run_id}
              className={`${ROW} motion-enter`}
              style={
                {
                  "--motion-delay": `${Math.min(index, 8) * 15}ms`,
                } as CSSProperties
              }
            >
              <span
                className={
                  index === 0
                    ? "w-20 font-bold tabular-nums"
                    : "w-20 tabular-nums"
                }
              >
                {formatTime(run.time)}
              </span>
              <span className="text-text-muted w-16 text-xs tabular-nums">
                {index === 0 || best == null
                  ? "PB"
                  : formatGap(run.time - best)}
              </span>
              <span className="text-text-muted min-w-0 flex-1 truncate">
                {run.server_name}
              </span>
              <time
                dateTime={run.finished_at}
                className="text-text-muted hidden tabular-nums sm:inline"
              >
                {formatDate(run.finished_at)}
              </time>
              <Link
                href={`/runs/${run.run_id}`}
                className="text-accent hover:text-accent-hover"
              >
                Run
              </Link>
            </li>
          ))}
        </DividedList>
      )}
    </Dialog>
  );
}
