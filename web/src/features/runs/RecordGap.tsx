// A run against the world record standing when it finished, in brackets after its time: green for what a new
// record took off, red for how far behind it was, as on the Activity board and a run's page.
import { classNames } from "@/ui/classNames";
import { formatGap, formatTime } from "./time";

export function RecordGap({
  gap,
  className,
}: {
  /** Seconds: below zero for a new record. */
  gap: number;
  className?: string;
}) {
  return (
    <span
      className={classNames(
        "tabular-nums",
        gap < 0 ? "text-success" : gap > 0 ? "text-danger" : "text-text-subtle",
        className,
      )}
    >
      {gap < 0 ? `(−${formatTime(-gap)})` : `(${formatGap(gap)})`}
    </span>
  );
}
