// A run against the world record standing when it finished, in brackets after its time: green for what a new
// record took off, or (NEW) for a board's first record, red for how far behind it was, as on the Activity board and
// a run's page.
import { classNames } from "@/ui/classNames";
import type { Gap } from "./gapWhenFinished";
import { formatGap, formatTime } from "./time";

export function RecordGap({
  gap,
  className,
}: {
  gap: Gap;
  className?: string;
}) {
  return (
    <span
      className={classNames(
        "tabular-nums",
        gap === "new" || gap < 0
          ? "text-success"
          : gap > 0
            ? "text-danger"
            : "text-text-subtle",
        className,
      )}
    >
      {gap === "new"
        ? "(NEW)"
        : gap < 0
          ? `(−${formatTime(-gap)})`
          : `(${formatGap(gap)})`}
    </span>
  );
}
