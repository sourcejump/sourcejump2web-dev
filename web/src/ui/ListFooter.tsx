// The line under a list that loads a page at a time: how much of it is shown, and the button that loads more.
import type { ReactNode } from "react";
import { Button } from "./Button";

/**
 * Every paged list ends the same way: the count on the left, "Show more" on the right. `onShowMore` is left
 * out once the whole list is shown. Renders nothing when there is neither a count, a button nor a failure.
 */
export function ListFooter({
  summary,
  onShowMore,
  loading = false,
  failed = false,
}: {
  /** What is shown out of how much, such as "Top 25 of 34 players". */
  summary?: ReactNode;
  onShowMore?: () => void;
  loading?: boolean;
  /** The last "Show more" didn't load; the button stays, to try again. */
  failed?: boolean;
}) {
  if (!summary && !onShowMore && !failed) return null;
  return (
    <div className="flex min-h-8 items-center gap-4">
      <span className="text-text-muted mr-auto text-sm tabular-nums">
        {summary}
      </span>
      {failed && (
        <span role="status" className="text-danger text-sm">
          More couldn&apos;t be loaded. Try again.
        </span>
      )}
      {onShowMore && (
        <Button size="sm" onClick={onShowMore} disabled={loading}>
          {loading ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}
