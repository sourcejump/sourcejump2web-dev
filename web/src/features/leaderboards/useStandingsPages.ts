// Paging a leaderboard without a wait, as on the Activity board: the server sends the chunk of players the page
// asked for falls in, pages within it turn here at once, and the chunks either side load ahead, so Next and
// Previous never wait. The page lives in the address (pushed, so Back works), and the pager's links and form still
// work without script. Shared by the overview's lists (StandingsPanel) and the full tables (StandingsTable).
import { useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, type Schemas } from "@/api/client";
import { STANDINGS_CHUNK } from "./BoardChoices";

type Standing = Schemas["ListedStanding"];

export function useStandingsPages({
  ranking,
  apiQuery,
  first,
  firstChunk,
  total,
  pageSize,
  param,
  path,
}: {
  ranking: Schemas["Ranking"];
  /** What the API takes for this board, without the paging. */
  apiQuery: Record<string, string | undefined>;
  /** The chunk the page asked for falls in, from the server; undefined when it couldn't be loaded. */
  first: Standing[] | undefined;
  firstChunk: number;
  total: number;
  pageSize: number;
  /** This list's page in the address. */
  param: string;
  /** The page's path, which the address keeps. */
  path: string;
}) {
  const params = useSearchParams();
  const asked = Math.max(1, Math.floor(Number(params.get(param))) || 1);
  const [chunks, setChunks] = useState<Record<number, Standing[]>>(
    first ? { [firstChunk]: first } : {},
  );
  const [failed, setFailed] = useState(false);
  /** Set after the first turn: pages turned here appear at once, without the rows' entrance. */
  const [turned, setTurned] = useState(false);
  const inFlight = useRef(new Map<number, Promise<boolean>>());
  /** The chunks loaded so far, read by `load` without waiting for a render. */
  const loaded = useRef(chunks);

  // A page is cut from one chunk, so it has to divide the chunk evenly; else a page spanning two would come up short.
  if (STANDINGS_CHUNK % pageSize !== 0) {
    throw new Error(
      `A page of ${pageSize} doesn't divide a chunk of ${STANDINGS_CHUNK}`,
    );
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(asked, pageCount);
  const chunkOf = useCallback(
    (p: number) => Math.floor(((p - 1) * pageSize) / STANDINGS_CHUNK),
    [pageSize],
  );

  const load = useCallback(
    (k: number): Promise<boolean> => {
      if (loaded.current[k]) return Promise.resolve(true);
      const pending = inFlight.current.get(k);
      if (pending) return pending;
      const request = api
        .GET("/v1/leaderboards/{ranking}", {
          params: {
            path: { ranking },
            query: {
              ...apiQuery,
              limit: STANDINGS_CHUNK,
              offset: k * STANDINGS_CHUNK,
            },
          },
        })
        .then((result) => result.data)
        .catch(() => undefined)
        .then((list) => {
          inFlight.current.delete(k);
          if (!list) {
            setFailed(true);
            return false;
          }
          setFailed(false);
          loaded.current = { ...loaded.current, [k]: list.standings };
          setChunks(loaded.current);
          return true;
        });
      inFlight.current.set(k, request);
      return request;
    },
    [ranking, apiQuery],
  );

  // The page shown, and the chunks either side of it, ready before they're asked for.
  const shownChunk = chunkOf(page);
  useEffect(() => {
    void load(shownChunk).then((ok) => {
      if (!ok) return;
      if ((shownChunk + 1) * STANDINGS_CHUNK < total) void load(shownChunk + 1);
      if (shownChunk > 0) void load(shownChunk - 1);
    });
  }, [shownChunk, total, load]);

  /** This list's page in the address, keeping the board and any other list's page. */
  const pageHref = useCallback(
    (to: number) => {
      const search = new URLSearchParams(params.toString());
      if (to > 1) search.set(param, String(to));
      else search.delete(param);
      const text = search.toString();
      return text ? `${path}?${text}` : path;
    },
    [params, param, path],
  );

  const turns = useRef(0);
  async function go(target: number) {
    const turn = ++turns.current;
    const wanted = Math.min(Math.max(1, target), pageCount);
    if (!(await load(chunkOf(wanted))) || turn !== turns.current) return;
    setTurned(true);
    window.history.pushState(null, "", pageHref(wanted));
  }

  /** For the pager's wrapper, in the capture phase: turns pages here instead of loading them. */
  function onPagerClick(event: MouseEvent<HTMLElement>) {
    const link = (event.target as HTMLElement).closest("a");
    if (
      !link ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    // Stopped here too, as Next's Link navigates even when the event is already prevented.
    event.preventDefault();
    event.stopPropagation();
    void go(Number(new URL(link.href).searchParams.get(param) ?? 1));
  }

  /** The pager's "go to page" form. */
  function onPagerSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.target as HTMLFormElement;
    const typed = Math.floor(Number(new FormData(form).get(param)));
    form.reset();
    if (typed >= 1) void go(typed);
  }

  const chunk = chunks[shownChunk];
  const start = (page - 1) * pageSize - shownChunk * STANDINGS_CHUNK;
  return {
    page,
    pageCount,
    /** The page's rows; undefined while they load or when they couldn't be. */
    shown: chunk?.slice(start, start + pageSize),
    failed,
    turned,
    pageHref,
    onPagerClick,
    onPagerSubmit,
  };
}
