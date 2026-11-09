// Page links under a paged list: both ends, the current page and its neighbours, and a box for going straight to
// a page.
import { ChevronLeft, ChevronRight } from "lucide-react";
import Form from "next/form";
import { type ReactNode, useId } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";

const cell =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm tabular-nums transition-colors duration-(--duration-fast)";
const link = "text-text-muted hover:bg-text/6 hover:text-text";
const number = new Intl.NumberFormat("en");

/**
 * Renders nothing when everything fits on one page. Pages count from 1 and sit in the address as `?page=` (or
 * `param`), so
 * `href(1)` also gives the address the box keeps. A list whose length isn't known yet passes the pages loaded so
 * far and `more`, and its last page shows as a gap.
 */
export function Pager({
  page,
  pageCount,
  more = false,
  total,
  noun,
  href,
  param = "page",
}: {
  page: number;
  pageCount: number;
  more?: boolean;
  /** How many items there are in all, shown before the page with `noun`: "3,599 runs". */
  total?: number;
  noun?: string;
  href: (page: number) => string;
  /** The address's name for the page, for a page with more than one list: `?page=` unless given. */
  param?: string;
}) {
  const box = useId();
  if (pageCount <= 1 && !more) return null;
  const last = more ? pageCount + 1 : pageCount;
  const shown = [
    ...new Set([1, page - 1, page, page + 1, ...(more ? [] : [pageCount])]),
  ]
    .filter((p) => p >= 1 && p <= last)
    .sort((a, b) => a - b);
  const base = new URL(href(1), "http://site");
  base.searchParams.delete(param);

  const items = [];
  let previous = 0;
  for (const p of shown) {
    if (p - previous > 1) items.push(<Gap key={`gap-${p}`} />);
    items.push(
      <Link
        key={p}
        href={href(p)}
        scroll={false}
        aria-current={p === page ? "page" : undefined}
        className={classNames(
          cell,
          p === page
            ? "bg-accent-soft text-accent ring-accent/30 font-bold ring-1 ring-inset"
            : link,
        )}
      >
        {p}
      </Link>,
    );
    previous = p;
  }
  if (more) items.push(<Gap key="more" />);
  // Room for the most links and the longest count any page of this list shows, so turning a page never changes the
  // row's width and wraps the controls under the count (1 … 4 5 6 … 11 is seven slots at most).
  const slots = Math.min(7, more ? last + 1 : last);
  // Capped at the row: on the narrowest phones the links take the full line under the count instead.
  const linksWidth = `min(100%, calc(${slots + 2} * 2rem + ${slots + 1} * 0.25rem))`;
  const countText = (p: number) =>
    `${total != null ? `${number.format(total)} ${noun} · page` : "Page"} ${number.format(p)}${more ? "" : ` of ${number.format(pageCount)}`}`;

  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      {/* The last page's count, hidden, under this page's: the box is as wide as the longest count. */}
      <span className="text-text-subtle mr-auto grid text-sm tabular-nums">
        <span aria-hidden className="invisible col-start-1 row-start-1">
          {countText(last)}
        </span>
        <span className="col-start-1 row-start-1">{countText(page)}</span>
      </span>
      <span
        className="flex items-center justify-end gap-1"
        style={{ minWidth: linksWidth }}
      >
        <Arrow
          href={page > 1 ? href(page - 1) : undefined}
          label="Previous page"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Arrow>
        {items}
        <Arrow
          href={page < last ? href(page + 1) : undefined}
          label="Next page"
        >
          <ChevronRight aria-hidden className="size-4" />
        </Arrow>
      </span>
      <Form
        action={base.pathname}
        scroll={false}
        prefetch={false}
        className="flex items-center gap-2 max-sm:hidden"
      >
        {[...base.searchParams].map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label htmlFor={box} className="text-text-subtle text-sm">
          Go to
        </label>
        <input
          id={box}
          type="number"
          name={param}
          min={1}
          max={more ? undefined : pageCount}
          placeholder={String(page)}
          required
          className="peer border-border bg-bg text-text placeholder:text-text-subtle hover:border-border-strong focus:border-accent h-8 w-16 [appearance:textfield] rounded-md border px-2 text-center text-sm tabular-nums transition-colors duration-(--duration-fast) outline-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {/* Lights up and takes clicks once the box holds a page it can go to; empty or out of range, it stays dim. */}
        <button
          type="submit"
          className="border-border bg-bg text-text-subtle peer-valid:border-accent/40 peer-valid:bg-accent-soft peer-valid:text-accent peer-valid:hover:bg-accent/20 h-8 rounded-md border px-3 text-sm font-bold transition-colors duration-(--duration-fast) peer-invalid:pointer-events-none"
        >
          Go
        </button>
      </Form>
    </nav>
  );
}

function Arrow({
  href,
  label,
  children,
}: {
  href?: string;
  label: string;
  children: ReactNode;
}) {
  if (!href)
    return (
      <span aria-hidden className={classNames(cell, "text-text-subtle/40")}>
        {children}
      </span>
    );
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      rel={label === "Previous page" ? "prev" : "next"}
      className={classNames(cell, link)}
    >
      {children}
    </Link>
  );
}

function Gap() {
  return (
    <span aria-hidden className="text-text-subtle w-4 text-center text-sm">
      …
    </span>
  );
}
