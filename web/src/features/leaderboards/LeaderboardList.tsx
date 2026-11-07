// One leaderboard in full, by points or by completions, a page at a time, under the same choices as the overview
// it opens from.
import { ArrowLeft } from "lucide-react";
import { api } from "@/api/client";
import { currentStyles } from "@/features/ruleset/styles";
import { Card } from "@/ui/Card";
import { Link } from "@/ui/Link";
import {
  type BoardParams,
  BoardChoices,
  boardApiQuery,
  boardFrom,
  boardQuery,
  completedLabel,
  LIST_PAGE_SIZE,
} from "./BoardChoices";
import { PointsNote } from "./PointsNote";
import { StandingsTable } from "./StandingsTable";

export type Ranking = "points" | "completed";

export function listTitle(ranking: Ranking, track: string | undefined) {
  return ranking === "points"
    ? "Top players"
    : completedLabel(track === "bonuses" ? "bonuses" : "main");
}

export async function LeaderboardList({
  ranking,
  params,
  page: requested,
}: {
  ranking: Ranking;
  params: BoardParams;
  /** `?page=` as given. */
  page?: string;
}) {
  const page = Math.max(1, Math.floor(Number(requested)) || 1);
  const styles = await currentStyles();
  const board = boardFrom(params, styles);
  const list = await api
    .GET("/v1/leaderboards/{ranking}", {
      params: {
        path: { ranking },
        query: {
          ...boardApiQuery(board),
          limit: LIST_PAGE_SIZE,
          offset: (page - 1) * LIST_PAGE_SIZE,
        },
      },
    })
    .then((result) => result.data)
    .catch(() => undefined);
  const query = boardQuery(board, styles);
  const label = completedLabel(board.track);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/leaderboards${query}`}
          className="text-text-muted hover:text-accent flex items-center gap-1 self-start text-sm"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Leaderboards
        </Link>
        <h1 className="text-3xl font-bold">
          {listTitle(ranking, board.track)}
        </h1>
      </div>
      <BoardChoices
        board={board}
        styles={styles}
        path={`/leaderboards/${ranking}`}
      />
      {!list ? (
        <p>This leaderboard couldn&apos;t be loaded. Try again in a moment.</p>
      ) : list.standings.length === 0 ? (
        <Card className="text-text-muted">
          {page > 1
            ? "There's no page this far."
            : ranking === "points"
              ? !board.legacy && !list.points.tiers
                ? "Points start once maps have tiers."
                : "Nobody has points here yet."
              : "Nobody has finished one yet."}
        </Card>
      ) : (
        <StandingsTable
          key={`${query}-${page}`}
          list={list}
          page={page}
          href={(to) => {
            const search = new URLSearchParams(query);
            if (to > 1) search.set("page", String(to));
            const text = search.toString();
            return `/leaderboards/${ranking}${text ? `?${text}` : ""}`;
          }}
          completedLabel={label}
        />
      )}
      {list && ranking === "points" && (
        <PointsNote formula={list.points} legacy={board.legacy} />
      )}
    </div>
  );
}
