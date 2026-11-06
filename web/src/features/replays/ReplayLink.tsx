"use client";
// A play button for a run's replay. A click plays it in a dialog over the page; a new tab opens the run page.
import { Play } from "lucide-react";
import type { MouseEvent } from "react";
import { openRun } from "@/features/runs/runDialog";
import { REPLAY_ANCHOR } from "./anchor";

export function ReplayLink({ runId }: { runId: number }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    openRun(runId, { replay: true });
  }
  return (
    <a
      href={`/runs/${runId}#${REPLAY_ANCHOR}`}
      onClick={onClick}
      aria-label="Watch replay"
      title="Watch replay"
      className="text-text-muted hover:bg-accent-soft hover:text-accent inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-(--duration-fast)"
    >
      <Play aria-hidden className="size-3.5 fill-current" />
    </a>
  );
}
