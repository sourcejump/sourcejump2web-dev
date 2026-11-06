// Opening and closing the run dialog: a `?run=` parameter on the current page's address, changed without a
// page load, so the dialog opens at once, can be shared, and Back closes it.

/** Whether this tab's history has the entry `openRun` added, so closing can step back over it. */
let openedHere = false;

export const RUN_PARAM = "run";
/** A pre-2.0 run: its own parameter, since the old site's run IDs can equal 2.0's. */
export const PRE_RUN_PARAM = "pre_run";
/** A run's replay, playing in the dialog. */
export const REPLAY_PARAM = "replay";

const PARAMS = [RUN_PARAM, PRE_RUN_PARAM, REPLAY_PARAM];

export function openRun(
  runId: number,
  { legacy = false, replay = false } = {},
) {
  const url = new URL(window.location.href);
  const param = legacy ? PRE_RUN_PARAM : replay ? REPLAY_PARAM : RUN_PARAM;
  for (const other of PARAMS) url.searchParams.delete(other);
  url.searchParams.set(param, String(runId));
  // Next.js syncs pushState into useSearchParams without navigating (docs: linking and navigating).
  window.history.pushState(null, "", url);
  openedHere = true;
}

export function closeRun() {
  if (openedHere) {
    openedHere = false;
    window.history.back();
    return;
  }
  // Opened from a shared link: there's no entry to step back to, so drop the parameter instead.
  const url = new URL(window.location.href);
  for (const param of PARAMS) url.searchParams.delete(param);
  window.history.replaceState(null, "", url);
}
