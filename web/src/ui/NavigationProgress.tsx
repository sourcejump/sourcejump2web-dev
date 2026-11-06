"use client";
// The accent bar across the top of the window while a link's page loads.
import { useLinkStatus } from "next/link";
import { useEffect, useSyncExternalStore } from "react";

type Phase = "idle" | "start" | "loading" | "done";

let pending = 0;
let phase: Phase = "idle";
let frame: number | undefined;
let timer: number | undefined;
const listeners = new Set<() => void>();

function show(next: Phase) {
  phase = next;
  for (const listener of listeners) listener();
}

function change(by: number) {
  const before = pending > 0;
  pending = Math.max(0, pending + by);
  const now = pending > 0;
  if (now === before) return;
  window.clearTimeout(timer);
  if (frame !== undefined) cancelAnimationFrame(frame);
  if (now) {
    show("start");
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => show("loading"));
    });
  } else {
    show("done");
    timer = window.setTimeout(() => show("idle"), 500);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Rendered inside every Link, to report its page loading. */
export function NavigationPending() {
  const { pending: loading } = useLinkStatus();
  useEffect(() => {
    if (!loading) return;
    change(1);
    return () => change(-1);
  }, [loading]);
  return null;
}

const styles: Record<Exclude<Phase, "idle">, string> = {
  start: "scale-x-0 transition-none",
  loading:
    "scale-x-90 transition-[scale] duration-[10s] ease-[cubic-bezier(0.1,0.7,0.1,1)]",
  done: "scale-x-100 opacity-0 transition-[scale,opacity] duration-200 ease-out [transition-delay:0s,200ms]",
};

export function NavigationProgress() {
  const current = useSyncExternalStore(
    subscribe,
    () => phase,
    () => "idle" as const,
  );
  if (current === "idle") return null;
  return (
    <div
      aria-hidden
      // Its own layer, so the page fade doesn't hide it.
      style={{ viewTransitionName: "navigation-progress" }}
      className={`bg-accent pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left ${styles[current]}`}
    />
  );
}
