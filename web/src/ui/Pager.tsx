// Page links under a paged list: both ends, the current page and its neighbours, and a box for going straight to
// a page.
import { ChevronLeft, ChevronRight } from "lucide-react";
import Form from "next/form";
import type { ReactNode } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";

const PARAM = "page";

const cell =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm tabular-nums transition-colors duration-(--duration-fast)";
const link = "text-text-muted hover:bg-text/8 hover:text-text";

/**
 * Renders nothing when everything fits on one page. Pages count from 1 and sit in the address as `?page=`, so
 * `href(1)` also gives the address the box keeps. A list whose length isn't known yet passes the pages loaded so
 * far and `more`, and its last page shows as a gap.
 */
export function Pager({
  page,
  pageCount,
  more = false,
  href,
}: {
  page: number;
  pageCount: number;
  more?: boolean;
  href: (page: number) => string;
}) {
  if (pageCount <= 1 && !more) return null;
  const last = more ? pageCount + 1 : pageCount;
  const shown = [
    ...new Set([1, page - 1, page, page + 1, ...(more ? [] : [pageCount])]),
  ]
    .filter((p) => p >= 1 && p <= last)
    .sort((a, b) => a - b);
  const base = new URL(href(1), "http://site");
  base.searchParams.delete(PARAM);

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
          p === page ? "bg-accent-soft text-accent font-bold" : link,
        )}
      >
        {p}
      </Link>,
    );
    previous = p;
  }
  if (more) items.push(<Gap key="more" />);

  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <span className="text-text-subtle mr-auto text-sm tabular-nums">
        Page {page}
        {!more && ` of ${pageCount}`}
      </span>
      <span className="flex items-center gap-1">
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
        <label className="text-text-subtle flex items-center gap-2 text-sm">
          Go to
          <input
            type="number"
            name={PARAM}
            min={1}
            max={more ? undefined : pageCount}
            placeholder={String(page)}
            required
            className="border-border bg-bg text-text placeholder:text-text-subtle focus:border-accent h-8 w-14 [appearance:textfield] rounded-md border px-2 text-center text-sm tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </label>
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
      <span aria-hidden className={classNames(cell, "text-text-subtle/50")}>
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
