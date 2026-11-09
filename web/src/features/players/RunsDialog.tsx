"use client";
// Every valid run a player has on one map, style and track, fastest first, with how far each is from their
// personal best, where it was set and a link to its run page. Opened from a personal best's run count.
import { useEffect, useState } from "react";
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
};

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
    void api
      .GET("/v1/players/{player}/runs", {
        params: {
          path: { player: steamid64 },
          query: { map: board.map, style: board.style, track: board.track },
        },
      })
      .then((result) => {
        if (!current) return;
        if (result.data) setPage(result.data);
        else setFailed(true);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [board, steamid64]);

  const best = page?.runs[0]?.time;
  return (
    <Dialog
      open={board !== undefined}
      onClose={onClose}
      title={
        shown && (
          <span className="flex flex-col">
            {shown.map}
            <span className="text-text-muted text-sm font-normal">
              {shown.styleName} · {trackName(shown.track)}
              {page && ` · ${page.total} ${page.total === 1 ? "run" : "runs"}`}
            </span>
          </span>
        )
      }
      footer={
        <p className="text-text-muted text-xs">
          {page && page.total > page.runs.length
            ? `The fastest ${page.runs.length} of ${page.total} valid runs. `
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
        <p className="text-text-muted text-sm">Loading…</p>
      ) : (
        <DividedList as="ol">
          {page.runs.map((run, index) => (
            <li
              key={run.run_id}
              className="flex items-center gap-4 py-2.5 text-sm"
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
