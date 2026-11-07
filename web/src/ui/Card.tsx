// A bordered surface that groups related content. `interactive` adds the hover lift for clickable cards.
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

export function Card({
  interactive = false,
  className,
  ...props
}: { interactive?: boolean } & ComponentProps<"div">) {
  return (
    <div
      className={classNames(
        "border-border bg-surface rounded-md border p-5",
        interactive && "motion-lift",
        className,
      )}
      {...props}
    />
  );
}

/** The small uppercase heading used on cards and in table headers. */
export function Label({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={classNames(
        "text-text-muted text-xs tracking-widest uppercase",
        className,
      )}
      {...props}
    />
  );
}
