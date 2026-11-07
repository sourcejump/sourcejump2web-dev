// Data tables such as leaderboards. Numeric cells right-align so times and diffs line up.
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

export function Table({
  flush = false,
  className,
  ...props
}: {
  /** No frame of its own. The parent supplies the surface, as on the activity board. */
  flush?: boolean;
} & ComponentProps<"table">) {
  return (
    // Wide tables scroll sideways on small screens instead of squeezing their columns. `relative` keeps
    // absolutely placed content, such as a visually hidden column name, inside the scrolling box. Never
    // vertically: rows rising into place (`motion-enter`) overflow for a moment, which flashed a scrollbar.
    <div
      className={classNames(
        "relative overflow-x-auto overflow-y-hidden",
        !flush && "border-border bg-surface rounded-md border",
        className,
      )}
    >
      {/* Separate borders, drawn by the cells: collapsed borders belong to the table, so a row still fading in
          (`motion-enter`) showed its lines, and a bright seam, before its content. */}
      <table
        className="w-full border-separate border-spacing-0 text-sm"
        {...props}
      />
    </div>
  );
}

export function TableHead(props: ComponentProps<"thead">) {
  return <thead {...props} />;
}

/** Each row after the first draws a line above its cells. */
export function TableBody(props: ComponentProps<"tbody">) {
  return (
    <tbody
      className="[&>tr+tr>td]:border-border [&>tr+tr>td]:border-t"
      {...props}
    />
  );
}

export function TableRow({
  highlight = false,
  separated = false,
  className,
  ...props
}: {
  highlight?: boolean;
  /** Starts a group apart from the rows above, such as a player's own place pinned under a board's top. */
  separated?: boolean;
} & ComponentProps<"tr">) {
  return (
    <tr
      className={classNames(
        "hover:bg-surface-raised transition-colors duration-(--duration-fast)",
        highlight && "bg-surface-raised",
        separated && "[&>td]:border-border [&>td]:border-t-2",
        className,
      )}
      {...props}
    />
  );
}

export function TableHeaderCell({
  numeric = false,
  centered = false,
  className,
  ...props
}: {
  numeric?: boolean;
  /** Over a column of marks narrower than its name (medals, a few digits), centered with them. */
  centered?: boolean;
} & ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={classNames(
        "text-text-muted border-border h-10 border-b px-4 text-xs font-normal tracking-widest whitespace-nowrap uppercase",
        centered ? "text-center" : numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  numeric = false,
  wrap = false,
  className,
  ...props
}: {
  numeric?: boolean;
  /** Lets long text, such as a server's hostname, wrap instead of widening the table. */
  wrap?: boolean;
} & ComponentProps<"td">) {
  return (
    <td
      className={classNames(
        "h-12 px-4",
        wrap ? "min-w-48 whitespace-normal" : "whitespace-nowrap",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}
