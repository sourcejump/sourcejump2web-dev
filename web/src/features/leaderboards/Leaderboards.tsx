// The Leaderboards page: in one style and kind of track, the top players by points and by completions, side
// by side. Pre-2.0 switches both lists to the old site's records.
import { ArrowRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { api, type Schemas } from "@/api/client";
import { currentStyles } from "@/features/ruleset/styles";
import { Avatar } from "@/ui/Avatar";
import { Card } from "@/ui/Card";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import {
  type BoardParams,
  BoardChoices,
  boardApiQuery,
  boardFrom,
  boardQuery,
  completedLabel,
} from "./BoardChoices";
import { PointsNote } from "./PointsNote";

type Standing = Schemas["Standing"];

const numbers = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", { style: "percent" });

export async function Leaderboards({ params }: { params: BoardParams }) {
  const styles = await currentStyles();
  const choice = boardFrom(params, styles);
  const legacy = choice.legacy;
  const board = await api
    .GET("/v1/leaderboards", { params: { query: boardApiQuery(choice) } })
    .then((result) => result.data)
    .catch(() => undefined);
  const query = boardQuery(choice, styles);

  return (
    <div className="flex flex-col gap-6">
      <BoardChoices board={choice} styles={styles} path="/leaderboards" />

      {!board ? (
        <p>The leaderboards couldn&apos;t be loaded. Try again in a moment.</p>
      ) : (
        <>
          {/* Keyed by what's shown, so every row enters on a new choice, not only the players who are new. */}
          <div key={query} className="grid gap-4 md:grid-cols-2">
            <List
              title="Top players"
              more={`/leaderboards/points${query}`}
              standings={board.top_players}
              empty={
                !legacy && !board.points.tiers
                  ? "Points start once maps have tiers."
                  : "Nobody has points here yet."
              }
              value={(standing) => numbers.format(standing.points)}
            />
            <List
              title={completedLabel(choice.track)}
              more={`/leaderboards/completed${query}`}
              standings={board.completed}
              empty="Nobody has finished one yet."
              value={(standing) => (
                <>
                  {numbers.format(standing.completed)}
                  {board.out_of > 0 && (
                    <span className="text-text-subtle ml-2 font-normal">
                      {percent.format(standing.completed / board.out_of)}
                    </span>
                  )}
                </>
              )}
            />
          </div>
          <PointsNote formula={board.points} legacy={legacy} />
        </>
      )}
    </div>
  );
}

function List({
  title,
  more,
  standings,
  empty,
  value,
}: {
  title: string;
  /** The full list's page. */
  more: string;
  standings: Standing[];
  empty: string;
  value: (standing: Standing) => ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">{title}</h2>
      {standings.length === 0 ? (
        <p className="text-text-muted text-sm">{empty}</p>
      ) : (
        <ol className="flex flex-col">
          {standings.map((standing, index) => (
            <li
              key={standing.player.steamid64}
              className="motion-enter flex h-9 items-center gap-3 text-sm"
              style={
                {
                  "--motion-delay": `${Math.min(index, 12) * 20}ms`,
                } as CSSProperties
              }
            >
              <Medal placement={standing.rank} />
              <Link
                href={`/players/${standing.player.steamid64}`}
                className="hover:text-accent flex min-w-0 items-center gap-2"
              >
                <Avatar
                  name={standing.player.name}
                  src={standing.player.avatar_url ?? undefined}
                  size="sm"
                />
                <span className="truncate">{standing.player.name}</span>
              </Link>
              <Flag code={standing.player.country_code} />
              <span className="ml-auto font-bold whitespace-nowrap tabular-nums">
                {value(standing)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {standings.length > 0 && (
        <Link
          href={more}
          className="text-text-muted hover:text-accent mt-auto flex items-center gap-1 self-start pt-1 text-sm"
        >
          Full list
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}
