"use client";
// One leaderboard in full, as a table, 15 players a page, turning without a wait (`useStandingsPages`). Beside each
// player's points and completions, their share of the tracks and their world records.
import type { CSSProperties } from "react";
import type { Schemas } from "@/api/client";
import { Avatar } from "@/ui/Avatar";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import { Pager } from "@/ui/Pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { LIST_PAGE_SIZE as PAGE_SIZE } from "./BoardChoices";
import { useStandingsPages } from "./useStandingsPages";
import { avatarSrc } from "@/features/players/avatarSrc";

const numbers = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", { style: "percent" });

type Standing = Schemas["ListedStanding"];

export function StandingsTable({
  ranking,
  apiQuery,
  first,
  firstChunk,
  total,
  outOf,
  legacy,
  path,
  completedLabel,
}: {
  ranking: Schemas["Ranking"];
  /** What the API takes for this board, without the paging. */
  apiQuery: Record<string, string | undefined>;
  /** The chunk the page asked for falls in, from the server. */
  first: Standing[];
  firstChunk: number;
  total: number;
  /** What completions are counted out of. */
  outOf: number;
  /** The Pre-2.0 view, which has no world records to count. */
  legacy: boolean;
  /** This list's own page, which the address keeps. */
  path: string;
  /** "Completed maps" or "Completed bonuses". */
  completedLabel: string;
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
    param: "page",
    path,
  });
  const byPoints = ranking === "points";

  // The ranked value comes first after the player, the other one after it.
  const pointsCell = (standing: Standing) => (
    <TableCell numeric className={byPoints ? "font-bold" : "text-text-muted"}>
      {numbers.format(standing.points)}
    </TableCell>
  );
  const completedCell = (standing: Standing) => (
    <TableCell numeric className={byPoints ? "text-text-muted" : "font-bold"}>
      {numbers.format(standing.completed)}
      {outOf > 0 && (
        <span className="text-text-subtle ml-2 font-normal">
          {percent.format(standing.completed / outOf)}
        </span>
      )}
    </TableCell>
  );

  if (!shown) {
    return (
      <p className="text-text-muted">
        {failed
          ? "This page couldn't be loaded. Try again in a moment."
          : "Loading…"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* On a phone the first view is the rank, the player and the ranked number, ending at the edge; the other
          numbers scroll into view. The lead is the rank column and the ranked number's (measured, with a little
          to spare), with the completed heading on two lines there. */}
      <Table phoneLead={byPoints ? "9.75rem" : "11.75rem"}>
        <TableHead>
          <tr>
            {/* Centered over the medals and numbers, which are narrower than the heading. */}
            <TableHeaderCell centered className="w-px">
              Rank
            </TableHeaderCell>
            {/* The player column takes the spare width, so the numbers sit together on the right, evenly spaced. */}
            <TableHeaderCell phoneFill className="w-full">
              Player
            </TableHeaderCell>
            {byPoints ? (
              <>
                <TableHeaderCell numeric>Points</TableHeaderCell>
                <TableHeaderCell numeric>{completedLabel}</TableHeaderCell>
              </>
            ) : (
              <>
                <TableHeaderCell numeric className="max-sm:whitespace-normal">
                  {completedLabel}
                </TableHeaderCell>
                <TableHeaderCell numeric>Points</TableHeaderCell>
              </>
            )}
            {!legacy && (
              <TableHeaderCell numeric>World records</TableHeaderCell>
            )}
          </tr>
        </TableHead>
        <TableBody>
          {shown.map((standing, index) => (
            <TableRow
              key={standing.player.steamid64}
              // Only the first page rises into place; a turned page swaps in at once.
              className={turned ? undefined : "motion-enter"}
              style={
                turned
                  ? undefined
                  : ({
                      "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                    } as CSSProperties)
              }
            >
              <TableCell className="text-center">
                {/* Counted down the list, not the shared rank of a tie, as on the overview (StandingsPanel). */}
                <span className="inline-flex justify-center align-middle">
                  <Medal placement={(page - 1) * PAGE_SIZE + index + 1} />
                </span>
              </TableCell>
              <TableCell phoneFill>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Link
                    href={`/players/${standing.player.steamid64}`}
                    className="hover:text-accent flex min-w-0 items-center gap-3"
                  >
                    {/* Left out below 360px, where the name needs the room. */}
                    <Avatar
                      name={standing.player.name}
                      src={avatarSrc(standing.player)}
                      size="sm"
                      className="max-xs:hidden"
                    />
                    <span className="truncate">{standing.player.name}</span>
                  </Link>
                  {standing.player.country_code && (
                    <Flag code={standing.player.country_code} />
                  )}
                </span>
              </TableCell>
              {byPoints ? (
                <>
                  {pointsCell(standing)}
                  {completedCell(standing)}
                </>
              ) : (
                <>
                  {completedCell(standing)}
                  {pointsCell(standing)}
                </>
              )}
              {!legacy && (
                <TableCell numeric className="text-text-muted">
                  {numbers.format(standing.world_records ?? 0)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageCount > 1 && (
        <div onClickCapture={onPagerClick} onSubmitCapture={onPagerSubmit}>
          <Pager
            page={page}
            pageCount={pageCount}
            total={total}
            noun={total === 1 ? "player" : "players"}
            href={pageHref}
          />
        </div>
      )}
    </div>
  );
}
