"use client";
// The Players page's search, answering as you type: the field beside the title, and in the panel under it the
// players matching what's typed, or with nothing typed, what the server sent (recently active players, or for
// staff the banned ones). Searches run in the browser the way the header's does: a short pause, each keystroke
// cancelling the request still out, late replies dropped, results kept up until the next arrive, and answers
// cached. The address follows, so a search can be shared; without script the form still submits.
import { Search, X } from "lucide-react";
import Form from "next/form";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { ButtonLink } from "@/ui/Button";
import { PlayerRows, SEARCH_LIMIT } from "./PlayerRows";
import { STEAMID } from "./steamId";

const PAUSE_MS = 150;

type Players = Schemas["PlayerSummary"][];

export function PlayerFinder({
  heading,
  initialQuery,
  initialPlayers,
  initialNow,
  defaultTitle,
  defaultAside,
  children,
  canManage,
}: {
  /** The page's title and count, on the field's line. */
  heading: ReactNode;
  initialQuery: string;
  /** The server's answer for `initialQuery`; undefined when it couldn't be loaded. */
  initialPlayers: Players | undefined;
  /** When the server asked, for the rows' "ago": time is read where data arrives, never while rendering. */
  initialNow: string;
  /** The panel's title with nothing typed: "Recently active" or "Banned". */
  defaultTitle: ReactNode;
  /** Beside it: what the times mean, or staff's tabs. */
  defaultAside: ReactNode;
  /** The panel's body with nothing typed, rendered on the server. */
  children: ReactNode;
  /** Staff who act on players, offered a SteamID nobody has seen. */
  canManage: boolean;
}) {
  const [text, setText] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [results, setResults] = useState<{
    query: string;
    players: Players | undefined;
    at: Date;
  }>({
    query: initialQuery.trim(),
    players: initialPlayers,
    at: new Date(initialNow),
  });
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const kept = useRef(
    new Map<string, Players>(
      initialPlayers
        ? [[initialQuery.trim().toLowerCase(), initialPlayers]]
        : [],
    ),
  );

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  function search(value: string) {
    const next = value.trim();
    setQuery(next);
    window.clearTimeout(timer.current);
    controller.current?.abort();
    const seq = ++sequence.current;
    // The address follows the field, replaced rather than pushed: one entry in the history per visit.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
    if (!next) return;
    const known = kept.current.get(next.toLowerCase());
    if (known) {
      setResults({ query: next, players: known, at: new Date() });
      return;
    }
    timer.current = window.setTimeout(async () => {
      const abort = new AbortController();
      controller.current = abort;
      try {
        const result = await api.GET("/v1/players", {
          params: { query: { q: next, limit: SEARCH_LIMIT } },
          signal: abort.signal,
        });
        if (seq !== sequence.current) return;
        const players = result.data?.players;
        if (players) kept.current.set(next.toLowerCase(), players);
        setResults({ query: next, players, at: new Date() });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (seq === sequence.current)
          setResults({ query: next, players: undefined, at: new Date() });
      }
    }, PAUSE_MS);
  }

  const searching = query !== "";
  // What's shown stays until the answer for the current text arrives, so typing never blanks the panel.
  const shown = results.players;
  const pending = searching && results.query !== query;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {heading}
        <Form
          action="/players"
          prefetch={false}
          className="w-full sm:w-80"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="group/field relative flex items-center">
            <Search
              aria-hidden
              className="text-text-subtle group-focus-within/field:text-accent pointer-events-none absolute left-3.5 size-4 transition-colors duration-(--duration-fast)"
            />
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              name="q"
              value={text}
              placeholder="Name or SteamID"
              aria-label="Search players"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setText(event.target.value);
                search(event.target.value);
              }}
              className="border-border bg-surface text-text placeholder:text-text-subtle hover:border-border-strong focus:border-accent focus:bg-bg h-10 w-full rounded-lg border pr-10 pl-10 transition-colors duration-(--duration-fast) outline-none"
            />
            {text && (
              <button
                type="button"
                aria-label="Clear the search"
                onClick={() => {
                  setText("");
                  search("");
                }}
                className="text-text-subtle hover:text-text absolute right-2 flex size-7 items-center justify-center rounded-md"
              >
                <X aria-hidden className="size-4" />
              </button>
            )}
          </div>
        </Form>
      </div>

      <section
        aria-busy={pending}
        className="border-border bg-surface overflow-hidden rounded-lg border"
      >
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
          <h2 className="text-lg font-bold">
            {!searching
              ? defaultTitle
              : shown && shown.length > 0
                ? shown.length === SEARCH_LIMIT
                  ? `First ${SEARCH_LIMIT} players matching “${results.query}”`
                  : `${shown.length === 1 ? "1 player matches" : `${shown.length} players match`} “${results.query}”`
                : `Players matching “${query}”`}
          </h2>
          {!searching ? (
            defaultAside
          ) : (
            <p className="text-text-subtle text-sm">
              {shown?.length === SEARCH_LIMIT
                ? "There may be more: add more of the name, or a SteamID."
                : "Latest finished run"}
            </p>
          )}
        </div>
        {!searching ? (
          children
        ) : !shown ? (
          <p className="border-border text-text-muted border-t px-5 py-6">
            {pending
              ? "Searching…"
              : "That search didn't work. Try again in a moment."}
          </p>
        ) : shown.length === 0 ? (
          <div className="border-border text-text-muted flex flex-col items-start gap-3 border-t px-5 py-6">
            {pending ? "Searching…" : "No player has that name or SteamID."}
            {!pending && canManage && STEAMID.test(query) && (
              <ButtonLink
                href={`/players/${encodeURIComponent(query)}/manage`}
                size="sm"
              >
                Manage {query} anyway
              </ButtonLink>
            )}
          </div>
        ) : (
          <PlayerRows players={shown} now={results.at} animate={false} />
        )}
      </section>
    </>
  );
}
