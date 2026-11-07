"use client";
// The header's search: players and maps as you type, in a panel under the field laid out as ok-website's is,
// each result a picture, its kind, its name and a figure. Arrow keys move through the results and Enter opens
// one; `/` anywhere jumps to the field. On narrower screens it's a button that opens the field across the header.
//
// Fast without flicker, as ok-website's: a short pause after typing before asking, each keystroke cancels the
// request still out for the old text, a sequence number drops any late reply, the results shown stay up until
// the next ones arrive, and answers are kept, so text already searched (backspacing, retyping) shows at once.
import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { api, type Schemas } from "@/api/client";
import { formatSince } from "@/features/runs/time";
import { Avatar } from "@/ui/Avatar";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";

const PAUSE_MS = 110;
const SHOWN = 5;
/** Answers kept for text already searched; the oldest go first. */
const KEPT = 40;

interface Found {
  query: string;
  /** When the answer arrived, for the rows' "ago": time is read where data arrives, never while rendering. */
  at: Date;
  players: Schemas["PlayerSummary"][];
  maps: Schemas["MapSummary"][];
}

type State =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "found"; found: Found }
  | { status: "failed" };

export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [open, setOpen] = useState(false);
  /** On narrow screens the field is hidden behind a button until opened. */
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const kept = useRef(new Map<string, Found>());

  // `/` focuses the search from anywhere that isn't already a text field.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable
      )
        return;
      event.preventDefault();
      setExpanded(true);
      requestAnimationFrame(() => input.current?.focus());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A page change closes the list; what was typed stays, so going back to it is one key away. Compared during
  // render, React's way to reset state when a value changes, so the old list never paints on the new page.
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
    setExpanded(false);
  }

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  function show(found: Found) {
    setState({ status: "found", found });
    setActive(-1);
    setOpen(true);
  }

  function search(value: string) {
    const query = value.trim();
    window.clearTimeout(timer.current);
    // Abort on the keystroke, not when the pause ends: a request in flight answers text that's gone.
    controller.current?.abort();
    const seq = ++sequence.current;
    if (!query) {
      setState({ status: "idle" });
      setOpen(false);
      return;
    }
    const known = kept.current.get(query.toLowerCase());
    if (known) {
      show(known);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const abort = new AbortController();
      controller.current = abort;
      // Results already up stay until the new ones land; only a first search shows "Searching".
      setState((current) =>
        current.status === "found" ? current : { status: "searching" },
      );
      setOpen(true);
      try {
        const [players, maps] = await Promise.all([
          api.GET("/v1/players", {
            params: { query: { q: query, limit: SHOWN } },
            signal: abort.signal,
          }),
          api.GET("/v1/maps", {
            params: { query: { q: query, sort: "popular", limit: SHOWN } },
            signal: abort.signal,
          }),
        ]);
        if (seq !== sequence.current) return;
        if (!players.data && !maps.data) throw new Error("search failed");
        const found = {
          query,
          at: new Date(),
          players: players.data?.players ?? [],
          maps: maps.data?.maps ?? [],
        };
        kept.current.set(query.toLowerCase(), found);
        if (kept.current.size > KEPT) {
          kept.current.delete(kept.current.keys().next().value!);
        }
        show(found);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (seq === sequence.current) setState({ status: "failed" });
      }
    }, PAUSE_MS);
  }

  const found = state.status === "found" ? state.found : null;
  /** Every result in the order the arrow keys walk them: players, then maps. */
  const targets = found
    ? [
        ...found.players.map((p) => `/players/${p.steamid64}`),
        ...found.maps.map((m) => `/maps/${encodeURIComponent(m.name)}`),
      ]
    : [];

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function go(href: string) {
    close();
    input.current?.blur();
    router.push(href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (open) close();
      else {
        input.current?.blur();
        setExpanded(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (targets.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      // -1 is the field itself, so the keys walk field, results, field.
      const slots = targets.length + 1;
      setActive((at) => ((at + 1 + step + slots) % slots) - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const query = text.trim();
      if (active >= 0 && targets[active]) go(targets[active]);
      // No result picked: the player search page holds every match, and finds a SteamID too.
      else if (query) go(`/players?q=${encodeURIComponent(query)}`);
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;
  const showList = open && state.status !== "idle";

  return (
    <div className="relative flex items-center">
      {/* The button that opens the field where the header has no room for it. */}
      <button
        type="button"
        aria-label="Search players and maps"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className={classNames(
          "text-text-muted hover:text-text hover:bg-surface-raised flex size-9 items-center justify-center rounded-md transition-colors duration-(--duration-fast) xl:hidden",
          expanded && "invisible",
        )}
      >
        <Search aria-hidden className="size-4.5" />
      </button>
      <div
        role="search"
        className={classNames(
          // Across the header's row on narrow screens once opened; in its place in the row on wide ones.
          "bg-gutter z-20 items-center max-xl:fixed max-xl:inset-x-0 max-xl:top-0 max-xl:h-16 max-xl:px-4 xl:relative xl:flex",
          expanded ? "flex" : "hidden",
        )}
      >
        <div className="group/field relative flex w-full items-center xl:w-64 2xl:w-72">
          <Search
            aria-hidden
            className="text-text-subtle group-focus-within/field:text-accent pointer-events-none absolute left-3 size-4 transition-colors duration-(--duration-fast)"
          />
          <input
            ref={input}
            // Text rather than search, so the browser adds no clear button of its own beside ours.
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={text}
            placeholder="Search players or maps"
            aria-label="Search players or maps"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              search(event.target.value);
            }}
            onFocus={() => {
              if (text.trim()) setOpen(true);
            }}
            onBlur={() => {
              // Late enough that a click on a result lands first.
              window.setTimeout(() => {
                close();
                if (!text.trim()) setExpanded(false);
              }, 150);
            }}
            onKeyDown={onKeyDown}
            className="border-border bg-surface text-text placeholder:text-text-subtle hover:border-border-strong focus:border-accent focus:bg-bg h-9 w-full rounded-md border pr-14 pl-9 text-sm transition-colors duration-(--duration-fast) outline-none"
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear the search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setText("");
                search("");
                input.current?.focus();
              }}
              className="text-text-subtle hover:text-text absolute right-2 flex size-6 items-center justify-center rounded-sm"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : (
            <kbd className="border-border text-text-subtle pointer-events-none absolute right-2 rounded-sm border px-1.5 text-xs leading-5 max-xl:hidden">
              /
            </kbd>
          )}
        </div>
        <button
          type="button"
          aria-label="Close the search"
          onClick={() => {
            setExpanded(false);
            close();
          }}
          className="text-text-muted hover:text-text ml-2 flex size-9 shrink-0 items-center justify-center rounded-md xl:hidden"
        >
          <X aria-hidden className="size-4.5" />
        </button>

        {showList && (
          <div
            id={listId}
            role="listbox"
            aria-label="Players and maps"
            // Keeps the field focused while a result is clicked.
            onMouseDown={(event) => event.preventDefault()}
            className="border-border-strong bg-surface-raised shadow-popover absolute top-full right-0 mt-2 max-h-120 overflow-y-auto overscroll-contain rounded-md border p-1.5 text-sm max-xl:inset-x-4 xl:w-96"
          >
            {state.status === "searching" && (
              <p className="text-text-muted px-3 py-4 text-center">
                Searching…
              </p>
            )}
            {state.status === "failed" && (
              <p className="text-text-muted px-3 py-4 text-center">
                Search isn&apos;t available right now. Try again in a moment.
              </p>
            )}
            {found &&
              (found.players.length === 0 && found.maps.length === 0 ? (
                <p className="text-text-muted px-3 py-4 text-center">
                  No players or maps match “{found.query}”.
                </p>
              ) : (
                <>
                  {found.players.length > 0 && (
                    <Group label="Players">
                      {found.players.map((player, index) => (
                        <Option
                          key={player.steamid64}
                          id={optionId(index)}
                          href={targets[index]!}
                          active={active === index}
                          onPick={close}
                          picture={
                            <Avatar
                              name={player.name}
                              src={player.avatar_url ?? undefined}
                            />
                          }
                          kind="Player"
                          name={
                            <>
                              <span className="truncate">{player.name}</span>
                              {player.country_code && (
                                <Flag code={player.country_code} />
                              )}
                            </>
                          }
                          figure={
                            player.last_run_at
                              ? formatSince(player.last_run_at, found.at)
                              : "No 2.0 runs"
                          }
                        />
                      ))}
                    </Group>
                  )}
                  {found.maps.length > 0 && (
                    <Group label="Maps">
                      {found.maps.map((map, i) => {
                        const index = found.players.length + i;
                        return (
                          <Option
                            key={map.name}
                            id={optionId(index)}
                            href={targets[index]!}
                            active={active === index}
                            onPick={close}
                            picture={
                              map.image ? (
                                // eslint-disable-next-line @next/next/no-img-element -- the API serves the thumbnail at its size
                                <img
                                  src={map.image.thumbnail_url}
                                  alt=""
                                  className="border-border size-8 rounded-sm border object-cover"
                                />
                              ) : (
                                <span className="border-border bg-surface text-text-subtle flex size-8 items-center justify-center rounded-sm border text-xs">
                                  #
                                </span>
                              )
                            }
                            kind={
                              map.tier != null
                                ? `Map · Tier ${map.tier}`
                                : "Map"
                            }
                            name={<span className="truncate">{map.name}</span>}
                            figure={`${map.players} ${map.players === 1 ? "player" : "players"}`}
                          />
                        );
                      })}
                    </Group>
                  )}
                  <div className="border-border mt-1.5 flex items-center justify-between gap-3 border-t px-2.5 pt-2.5 pb-1.5">
                    <Link
                      href={`/players?q=${encodeURIComponent(found.query)}`}
                      tabIndex={-1}
                      onClick={close}
                      className="text-accent hover:text-accent-hover truncate"
                    >
                      All players matching “{found.query}”
                    </Link>
                    <Link
                      href={`/maps?q=${encodeURIComponent(found.query)}`}
                      tabIndex={-1}
                      onClick={close}
                      className="text-accent hover:text-accent-hover shrink-0"
                    >
                      All maps
                    </Link>
                  </div>
                </>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="text-text-subtle px-2.5 pt-2 pb-1.5 text-xs tracking-widest uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

/** One result: its picture, its kind above its name, and a figure at the end, as ok-website lays them out. */
function Option({
  id,
  href,
  active,
  onPick,
  picture,
  kind,
  name,
  figure,
}: {
  id: string;
  href: string;
  active: boolean;
  onPick: () => void;
  picture: ReactNode;
  kind: string;
  name: ReactNode;
  figure: string;
}) {
  return (
    <Link
      id={id}
      href={href}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onPick}
      className={classNames(
        "flex min-h-12 items-center gap-3 rounded-sm px-2.5 py-1.5 transition-colors duration-(--duration-fast)",
        active ? "bg-text/8" : "hover:bg-text/6",
      )}
    >
      <span className="shrink-0">{picture}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-text-subtle text-xs leading-4">{kind}</span>
        <span className="text-text flex min-w-0 items-center gap-1.5 font-bold">
          {name}
        </span>
      </span>
      <span className="text-text-muted shrink-0 text-xs tabular-nums">
        {figure}
      </span>
    </Link>
  );
}
