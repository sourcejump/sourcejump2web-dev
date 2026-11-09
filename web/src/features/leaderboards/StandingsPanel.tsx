"use client";
// One list of the Leaderboards page, a page of 20 at a time, turning without a wait (`useStandingsPages`).
import type { CSSProperties, ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { Avatar } from "@/ui/Avatar";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { Pager } from "@/ui/Pager";
import { OVERVIEW_PAGE_SIZE as PAGE_SIZE } from "./BoardChoices";
import { useStandingsPages } from "./useStandingsPages";
import { avatarSrc } from "@/features/players/avatarSrc";

type Standing = Schemas["ListedStanding"];
type Ranking = Schemas["Ranking"];

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
  const {
    page,
    pageCount,
    shown,
    failed,
    turned,
    pageHref,
    onPagerClick,
    onPagerSubmit,
  } = useStandingsPages({
    ranking,
    apiQuery,
    first,
    firstChunk,
    total,
    pageSize: PAGE_SIZE,
    param,
    path: "/leaderboards",
  });

  return (
    <section className="border-border bg-surface min-w-0 overflow-hidden rounded-md border">
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
              <Row
                standing={standing}
                place={(page - 1) * PAGE_SIZE + index + 1}
              >
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
  place,
  children,
}: {
  standing: Standing;
  /**
   * The row's place down the list, counted 1, 2, 3 even where players tie: a column of the same rank repeated
   * read as a mistake. Ties keep the API's order.
   */
  place: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={`/players/${standing.player.steamid64}`}
      className="group hover:bg-text/4 flex h-14 items-center gap-3 px-5 transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2"
    >
      <Medal placement={place} />
      <Avatar name={standing.player.name} src={avatarSrc(standing.player)} />
      {/* The flag sits close to the name it belongs to; most players have no country on Steam, and a
          placeholder on every row would only be noise. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="group-hover:text-accent min-w-0 truncate transition-colors duration-(--duration-fast)">
          {standing.player.name}
        </span>
        {standing.player.country_code && (
          <Flag code={standing.player.country_code} />
        )}
      </span>
      <span className="ml-auto shrink-0 pl-2 text-right tabular-nums">
        {children}
      </span>
    </Link>
  );
}
