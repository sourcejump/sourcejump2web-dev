// Data tables such as leaderboards. Numeric cells right-align so times and diffs line up.
import type { ComponentProps, CSSProperties } from "react";
import { classNames } from "./classNames";

export function Table({
  flush = false,
  phoneLead,
  className,
  ...props
}: {
  /** No frame of its own. The parent supplies the surface, as on the activity board. */
  flush?: boolean;
  /**
   * On a phone, the width of the leading columns besides the `phoneFill` one (a CSS length), so those columns make up
   * the first view exactly and the rest scroll into view, rather than one cut through at the edge.
   */
  phoneLead?: string;
} & ComponentProps<"table">) {
  return (
    // Wide tables scroll sideways on small screens instead of squeezing their columns. `relative` keeps
    // absolutely placed content, such as a visually hidden column name, inside the scrolling box. Never
    // vertically: rows rising into place (`motion-enter`) overflow for a moment, which flashed a scrollbar.
    <div
      className={classNames(
        "relative overflow-x-auto overflow-y-hidden",
        phoneLead && "@container",
        !flush && "border-border bg-surface rounded-md border",
        className,
      )}
      style={
        phoneLead ? ({ "--phone-lead": phoneLead } as CSSProperties) : undefined
      }
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
        // Hover lightens the row a touch, staying darker than the dividers: a surface-raised fill was nearly their
        // color, so the lines above and below the row vanished. Lists of rows elsewhere use the same hover.
        "hover:bg-text/4 transition-colors duration-(--duration-fast)",
        highlight && "bg-surface-raised",
        separated && "[&>td]:border-border [&>td]:border-t-2",
        className,
      )}
      {...props}
    />
  );
}

/** On a phone, the scroll area's width less the table's `phoneLead`. */
const phoneFillWidth =
  "max-sm:w-[calc(100cqw-var(--phone-lead))] max-sm:max-w-[calc(100cqw-var(--phone-lead))]";

export function TableHeaderCell({
  numeric = false,
  centered = false,
  phoneFill = false,
  className,
  ...props
}: {
  numeric?: boolean;
  /** Over a column of marks narrower than its name (medals, a few digits), centered with them. */
  centered?: boolean;
  /** On a phone, the column that takes what the table's `phoneLead` columns leave; its cells set `phoneFill` too. */
  phoneFill?: boolean;
} & ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={classNames(
        "text-text-muted border-border h-10 border-b px-4 text-xs font-normal tracking-widest whitespace-nowrap uppercase",
        centered ? "text-center" : numeric ? "text-right" : "text-left",
        phoneFill && phoneFillWidth,
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  numeric = false,
  wrap = false,
  phoneFill = false,
  className,
  children,
  ...props
}: {
  numeric?: boolean;
  /** Lets long text, such as a server's hostname, wrap instead of widening the table. */
  wrap?: boolean;
  /** In the header's `phoneFill` column: on a phone held to its width, so long content is cut rather than widening it. */
  phoneFill?: boolean;
} & ComponentProps<"td">) {
  return (
    <td
      className={classNames(
        "h-12 px-4",
        wrap ? "min-w-48 whitespace-normal" : "whitespace-nowrap",
        numeric && "text-right tabular-nums",
        phoneFill && phoneFillWidth,
        className,
      )}
      {...props}
    >
      {/* A cell's content counts toward its column's width whatever the cell's own width says, so on a phone it sits
          in a box of the column's width (less the padding), which content can't widen. */}
      {phoneFill ? (
        <div className="max-sm:w-[calc(100cqw-var(--phone-lead)-2rem)] max-sm:overflow-hidden">
          {children}
        </div>
      ) : (
        children
      )}
    </td>
  );
}
