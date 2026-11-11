// A small play button in its own narrow column right after a table's times: a shortcut to the run's page with its
// replay starting. Its own column, so the times keep their right edge whether a run has a replay or not.
import { Play } from "lucide-react";
import { Link } from "@/ui/Link";
import { TableCell, TableHeaderCell } from "@/ui/Table";
import { REPLAY_ANCHOR } from "./anchor";

/** Give the time column's cells `TIME_BESIDE_REPLAY` too, so the button sits close to the time. */
export const TIME_BESIDE_REPLAY = "pr-1.5 sm:pr-1.5";

export function ReplayHeaderCell() {
  return (
    <TableHeaderCell className="w-px pr-2 pl-0 sm:pr-2 sm:pl-0">
      <span className="sr-only">Replay</span>
    </TableHeaderCell>
  );
}

/** Empty for a run without a watchable replay. */
export function ReplayCell({
  runId,
  hasReplay,
}: {
  runId: number;
  hasReplay: boolean;
}) {
  return (
    <TableCell className="w-px pr-2 pl-0 sm:pr-2 sm:pl-0">
      {hasReplay && (
        <Link
          href={`/runs/${runId}#${REPLAY_ANCHOR}`}
          aria-label="Watch replay"
          className="text-text-subtle hover:text-accent hover:bg-surface-raised inline-flex size-5 items-center justify-center rounded-sm align-middle transition-colors duration-(--duration-fast)"
        >
          <Play aria-hidden className="size-3" fill="currentColor" />
        </Link>
      )}
    </TableCell>
  );
}
