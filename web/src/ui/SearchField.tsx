"use client";
// A search field that updates the current route after a short pause, so list pages do not need a submit button.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { classNames } from "./classNames";

export function SearchField({
  name,
  defaultValue,
  placeholder,
  label,
  className,
  live = false,
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
  /** Names the field for screen readers, since the placeholder isn't a label. */
  label: string;
  className?: string;
  live?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue ?? "");

  useEffect(() => {
    if (!live || value.trim() === (searchParams.get(name) ?? "")) return;
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed) params.set(name, trimmed);
      else params.delete(name);
      params.delete("page");
      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      if (nextUrl !== window.location.pathname + window.location.search) {
        startTransition(() => router.replace(nextUrl, { scroll: false }));
      }
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [live, name, pathname, router, searchParams, value]);

  return (
    <div className={classNames("relative w-full", className)}>
      <input
        type="search"
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="border-border bg-surface text-text placeholder:text-text-subtle hover:border-border-strong focus:border-accent focus:bg-bg h-9 w-full rounded-md border pr-10 pl-3.5 text-sm transition-colors duration-(--duration-fast) outline-none"
      />
      {live ? (
        <Search
          aria-hidden
          className="text-text-muted pointer-events-none absolute inset-y-0 right-3 my-auto size-4"
        />
      ) : (
        <button
          type="submit"
          aria-label="Search"
          className="text-text-muted hover:text-accent absolute inset-y-1 right-1 grid w-9 place-items-center rounded-sm transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
        >
          <Search aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
