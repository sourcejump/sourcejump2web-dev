// The Leaderboards page: in one style and kind of track, the top players by points and by completions, side
// by side, each a page at a time with its own pager, turning without a wait (StandingsPanel). Pre-2.0 switches
// both lists to the old site's records.
import { api, type Schemas } from "@/api/client";
import { currentStyles } from "@/features/ruleset/styles";
import {
  type Board,
  type BoardParams,
  BoardChoices,
  boardApiQuery,
  boardFrom,
  boardQuery,
  completedLabel,
  OVERVIEW_CHUNK as CHUNK,
  OVERVIEW_PAGE_SIZE as PAGE_SIZE,
} from "./BoardChoices";
import { PointsNote } from "./PointsNote";
import { StandingsPanel } from "./StandingsPanel";

type Ranking = Schemas["Ranking"];

/** Each list keeps its own page in the address, so paging one leaves the other where it is. */
const PAGE_PARAM: Record<Ranking, string> = {
  points: "points_page",
  completed: "completed_page",
};

const numbers = new Intl.NumberFormat("en");

export async function Leaderboards({
  params,
  pages,
}: {
  params: BoardParams;
  /** The `points_page` and `completed_page` from the address, as given. */
  pages: Partial<Record<Ranking, string>>;
}) {
  const styles = await currentStyles();
  const choice = boardFrom(params, styles);
  const query = boardQuery(choice, styles);
  const chunkOf = (ranking: Ranking) => {
    const page = Math.max(1, Math.floor(Number(pages[ranking])) || 1);
    return Math.floor(((page - 1) * PAGE_SIZE) / CHUNK);
  };
  const [points, completed] = await Promise.all([
    load("points", choice, chunkOf("points")),
    load("completed", choice, chunkOf("completed")),
  ]);
  const formula = points?.points ?? completed?.points;
  const apiQuery = boardApiQuery(choice);

  return (
    <div className="flex flex-col gap-4">
      <BoardChoices board={choice} styles={styles} path="/leaderboards" />
      {/* Keyed by the board, so another choice starts both lists again from what the server sent. */}
      <div key={query} className="grid items-start gap-4 lg:grid-cols-2">
        <StandingsPanel
          ranking="points"
          title="Top players"
          note={formula?.draft && !choice.legacy ? "Draft points" : undefined}
          full={`/leaderboards/points${query}`}
          param={PAGE_PARAM.points}
          apiQuery={apiQuery}
          first={points?.standings}
          firstChunk={chunkOf("points")}
          total={points?.total ?? 0}
          outOf={points?.out_of ?? 0}
          bonuses={choice.track === "bonuses"}
          empty={
            !choice.legacy && formula && !formula.tiers
              ? "Points start once maps have tiers."
              : "Nobody has points here yet."
          }
        />
        <StandingsPanel
          ranking="completed"
          title={completedLabel(choice.track)}
          note={completed && `Out of ${numbers.format(completed.out_of)}`}
          full={`/leaderboards/completed${query}`}
          param={PAGE_PARAM.completed}
          apiQuery={apiQuery}
          first={completed?.standings}
          firstChunk={chunkOf("completed")}
          total={completed?.total ?? 0}
          outOf={completed?.out_of ?? 0}
          bonuses={choice.track === "bonuses"}
          empty="Nobody has finished one yet."
        />
      </div>
      {formula && <PointsNote formula={formula} legacy={choice.legacy} />}
    </div>
  );
}

/** The hundred players around the page asked for; undefined when they can't be loaded. */
function load(ranking: Ranking, board: Board, chunk: number) {
  return api
    .GET("/v1/leaderboards/{ranking}", {
      params: {
        path: { ranking },
        query: { ...boardApiQuery(board), limit: CHUNK, offset: chunk * CHUNK },
      },
    })
    .then((result) => result.data)
    .catch(() => undefined);
}
