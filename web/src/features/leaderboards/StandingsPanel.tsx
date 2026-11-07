"use client";
// One list of the Leaderboards page, a page of 20 at a time, turning without a wait as on the Activity board:
// the server sends the hundred players around the page asked for, pages within them turn here at once, and the
// hundreds either side load ahead, so Next and Previous never wait. The pager's links still work without script.
import { useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, type Schemas } from "@/api/client";
import { Avatar } from "@/ui/Avatar";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { Pager } from "@/ui/Pager";
import { OVERVIEW_CHUNK, OVERVIEW_PAGE_SIZE } from "./BoardChoices";

type Standing = Schemas["ListedStanding"];
type Ranking = Schemas["Ranking"];

const PAGE_SIZE = OVERVIEW_PAGE_SIZE;
const CHUNK = OVERVIEW_CHUNK;

const numbers = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", { style: "percent" });

export function StandingsPanel({
  ranking,
  title,
  note,
  full,
  param,
  apiQuery,
  first,
  firstChunk,
  total,
  outOf,
  bonuses,
  empty,
}: {
  ranking: Ranking;
  title: string;
  /** Beside the title, e.g. that points are a draft. */
  note?: string;
  /** The list on its own page, with more columns. */
  full: string;
  /** This list's page in the address. */
  param: string;
  /** What the API takes for this board, without the paging. */
  apiQuery: Record<string, string | undefined>;
  /** The chunk the page asked for falls in, from the server; undefined when it couldn't be loaded. */
  first: Standing[] | undefined;
  firstChunk: number;
  total: number;
  /** What completions are counted out of. */
  outOf: number;
  bonuses: boolean;
  empty: string;
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

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(asked, pageCount);
  const chunkOf = (p: number) => Math.floor(((p - 1) * PAGE_SIZE) / CHUNK);

  const load = useCallback(
    (k: number): Promise<boolean> => {
      if (loaded.current[k]) return Promise.resolve(true);
      const pending = inFlight.current.get(k);
      if (pending) return pending;
      const request = api
        .GET("/v1/leaderboards/{ranking}", {
          params: {
            path: { ranking },
            query: { ...apiQuery, limit: CHUNK, offset: k * CHUNK },
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

  // The page shown, and the hundreds either side of it, ready before they're asked for.
  const shownChunk = chunkOf(page);
  useEffect(() => {
    void load(shownChunk).then((ok) => {
      if (!ok) return;
      if ((shownChunk + 1) * CHUNK < total) void load(shownChunk + 1);
      if (shownChunk > 0) void load(shownChunk - 1);
    });
  }, [shownChunk, total, load]);

  /** This list's page in the address, keeping the board and the other list's page. */
  const pageHref = useCallback(
    (to: number) => {
      const search = new URLSearchParams(params.toString());
      if (to > 1) search.set(param, String(to));
      else search.delete(param);
      const text = search.toString();
      return text ? `/leaderboards?${text}` : "/leaderboards";
    },
    [params, param],
  );

  const turns = useRef(0);
  async function go(target: number) {
    const turn = ++turns.current;
    const wanted = Math.min(Math.max(1, target), pageCount);
    if (!(await load(chunkOf(wanted))) || turn !== turns.current) return;
    setTurned(true);
    window.history.pushState(null, "", pageHref(wanted));
  }

  function onPagerClick(event: MouseEvent<HTMLDivElement>) {
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

  function onPagerSubmit(event: FormEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.target as HTMLFormElement;
    const typed = Math.floor(Number(new FormData(form).get(param)));
    form.reset();
    if (typed >= 1) void go(typed);
  }

  const chunk = chunks[shownChunk];
  const start = (page - 1) * PAGE_SIZE - shownChunk * CHUNK;
  const shown = chunk?.slice(start, start + PAGE_SIZE);

  return (
    <section className="border-border bg-surface min-w-0 overflow-hidden rounded-lg border">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="flex items-baseline gap-2 text-lg font-bold">
          {title}
          {note && (
            <span className="text-text-subtle text-xs font-normal">{note}</span>
          )}
        </h2>
        <Link
          href={full}
          className="text-text-muted hover:text-accent shrink-0 text-sm"
        >
          Full table
        </Link>
      </div>
      {total === 0 && first ? (
        <p className="text-text-muted px-5 pb-5">{empty}</p>
      ) : !shown ? (
        <p className="text-text-muted px-5 pb-5">
          {failed
            ? "This list couldn't be loaded. Try again in a moment."
            : "Loading…"}
        </p>
      ) : (
        <ol className="divide-border border-border divide-y border-t">
          {shown.map((standing, index) => (
            <li
              key={standing.player.steamid64}
              className={turned ? undefined : "motion-enter"}
              style={
                turned
                  ? undefined
                  : ({
                      "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                    } as CSSProperties)
              }
            >
              <Row standing={standing}>
                {ranking === "points" ? (
                  <>
                    <span className="font-bold">
                      {numbers.format(standing.points)}
                    </span>
                    <span className="text-text-subtle block text-xs">
                      {numbers.format(standing.completed)}{" "}
                      {bonuses ? "bonuses" : "maps"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-bold">
                      {numbers.format(standing.completed)}
                    </span>
                    {outOf > 0 && (
                      <span className="text-text-subtle block text-xs">
                        {percent.format(standing.completed / outOf)}
                      </span>
                    )}
                  </>
                )}
              </Row>
            </li>
          ))}
        </ol>
      )}
      {total > PAGE_SIZE && (
        <div
          onClickCapture={onPagerClick}
          onSubmitCapture={onPagerSubmit}
          className="border-border border-t px-5 py-2"
        >
          <Pager
            page={page}
            pageCount={pageCount}
            total={total}
            noun={total === 1 ? "player" : "players"}
            href={pageHref}
            param={param}
          />
        </div>
      )}
    </section>
  );
}

function Row({
  standing,
  children,
}: {
  standing: Standing;
  children: ReactNode;
}) {
  return (
    <Link
      href={`/players/${standing.player.steamid64}`}
      className="group hover:bg-surface-raised flex h-14 items-center gap-3 px-5 transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
    >
      <Medal placement={standing.rank} />
      <Avatar
        name={standing.player.name}
        src={standing.player.avatar_url ?? undefined}
      />
      <span className="group-hover:text-accent min-w-0 truncate transition-colors duration-(--duration-fast)">
        {standing.player.name}
      </span>
      {/* Most players have no country on Steam; a placeholder on every row would only be noise. */}
      {standing.player.country_code && (
        <Flag code={standing.player.country_code} />
      )}
      <span className="ml-auto shrink-0 pl-2 text-right tabular-nums">
        {children}
      </span>
    </Link>
  );
}
