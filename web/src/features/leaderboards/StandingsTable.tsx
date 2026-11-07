// One leaderboard in full, as a table, a page of 50 at a time with page links beneath. Beside each player's points
// and completions, their share of the tracks and their world records.
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

const numbers = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", { style: "percent" });

type List = Schemas["LeaderboardList"];

export function StandingsTable({
  list,
  page,
  href,
  completedLabel,
}: {
  list: List;
  page: number;
  /** The address of another page of this board. */
  href: (page: number) => string;
  /** "Completed maps" or "Completed bonuses". */
  completedLabel: string;
}) {
  const first = list;
  const standings = list.standings;
  const byPoints = first.ranking === "points";
  const legacy = first.view === "legacy";

  // The ranked value comes first after the player, the other one after it.
  const pointsCell = (standing: Schemas["ListedStanding"]) => (
    <TableCell numeric className={byPoints ? "font-bold" : "text-text-muted"}>
      {numbers.format(standing.points)}
    </TableCell>
  );
  const completedCell = (standing: Schemas["ListedStanding"]) => (
    <TableCell numeric className={byPoints ? "text-text-muted" : "font-bold"}>
      {numbers.format(standing.completed)}
      {first.out_of > 0 && (
        <span className="text-text-subtle ml-2 font-normal">
          {percent.format(standing.completed / first.out_of)}
        </span>
      )}
    </TableCell>
  );

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className="w-16">Rank</TableHeaderCell>
            {/* The player column takes the spare width, so the numbers sit together on the right, evenly spaced. */}
            <TableHeaderCell className="w-full">Player</TableHeaderCell>
            {byPoints ? (
              <>
                <TableHeaderCell numeric>Points</TableHeaderCell>
                <TableHeaderCell numeric>{completedLabel}</TableHeaderCell>
              </>
            ) : (
              <>
                <TableHeaderCell numeric>{completedLabel}</TableHeaderCell>
                <TableHeaderCell numeric>Points</TableHeaderCell>
              </>
            )}
            {!legacy && (
              <TableHeaderCell numeric>World records</TableHeaderCell>
            )}
          </tr>
        </TableHead>
        <TableBody>
          {standings.map((standing, index) => (
            <TableRow
              key={standing.player.steamid64}
              className="motion-enter"
              style={
                {
                  "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                } as CSSProperties
              }
            >
              <TableCell>
                <Medal placement={standing.rank} />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Link
                    href={`/players/${standing.player.steamid64}`}
                    className="hover:text-accent flex items-center gap-3"
                  >
                    <Avatar
                      name={standing.player.name}
                      src={standing.player.avatar_url ?? undefined}
                      size="sm"
                    />
                    {standing.player.name}
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
      <Pager
        page={page}
        pageCount={Math.max(1, Math.ceil(first.total / PAGE_SIZE))}
        total={first.total}
        noun={first.total === 1 ? "player" : "players"}
        href={href}
      />
    </div>
  );
}
