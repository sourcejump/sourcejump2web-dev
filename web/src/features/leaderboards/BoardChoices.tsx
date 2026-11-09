// The Style, Track and 2.0 / Pre-2.0 choices of the leaderboards, read from and written to the address. The
// overview and each full list share them, so switching between those pages keeps the choice.
import type { Schemas } from "@/api/client";
import type { currentStyles } from "@/features/ruleset/styles";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { LinkTabs } from "@/ui/LinkTabs";

export type Track = Schemas["LeaderboardTrack"];
/**
 * Players per page: 15 on a full list (a screen's worth), 20 on each of the overview's two lists. Either turns
 * pages in the browser, from chunks of players loaded a request at a time (`useStandingsPages`). Here and not in
 * a client module, whose exports reach server code only as references.
 */
export const LIST_PAGE_SIZE = 15;
export const OVERVIEW_PAGE_SIZE = 20;
/**
 * A multiple of both page sizes, so every page lies within one chunk: with 100, page 7 of 15 (players 91 to 105)
 * spanned two chunks and showed only the first one's ten.
 */
export const STANDINGS_CHUNK = 60;
type Styles = Awaited<ReturnType<typeof currentStyles>>;

export interface BoardParams {
  style?: string;
  track?: string;
  view?: string;
}

export interface Board {
  /** Undefined only when no ruleset is published. */
  style: string | undefined;
  track: Track;
  legacy: boolean;
}

/** The board the address asks for. Pre-2.0 is one style's main tracks, so it overrides the other two. */
export function boardFrom(params: BoardParams, styles: Styles): Board {
  const legacy = params.view === "legacy";
  return {
    legacy,
    track: params.track === "bonuses" && !legacy ? "bonuses" : "main",
    style:
      params.style && styles.keys.includes(params.style) && !legacy
        ? params.style
        : styles.keys[0],
  };
}

/** The query string for a board, with defaults left out: "" for the default board. */
export function boardQuery(board: Board, styles: Styles): string {
  const query = new URLSearchParams();
  if (board.legacy) query.set("view", "legacy");
  else {
    if (board.style && board.style !== styles.keys[0]) {
      query.set("style", board.style);
    }
    if (board.track === "bonuses") query.set("track", "bonuses");
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** What the API takes for a board. */
export function boardApiQuery(board: Board) {
  return board.legacy
    ? { view: "legacy" as const }
    : { style: board.style, track: board.track, view: "current" as const };
}

export function BoardChoices({
  board,
  styles,
  path,
}: {
  board: Board;
  styles: Styles;
  /** The page the choices link to: the overview or one full list. */
  path: string;
}) {
  const href = (change: Partial<Board>) =>
    path + boardQuery({ ...board, ...change }, styles);
  return (
    <ChoiceBar>
      {/* Pre-2.0 records are one style's main tracks, so the other choices are kept in place but off. */}
      <ChoiceMenu
        label="Style"
        options={styles.keys.map((key) => ({
          value: key,
          label: styles.name(key),
          href: href({ style: key }),
          disabled: board.legacy && key !== styles.keys[0],
        }))}
        value={board.style ?? ""}
      />
      <ChoiceMenu
        label="Track"
        options={[
          { value: "main", label: "Main", href: href({ track: "main" }) },
          {
            value: "bonuses",
            label: "Bonuses",
            href: href({ track: "bonuses" }),
            disabled: board.legacy,
          },
        ]}
        value={board.track}
      />
      <div className="ml-auto">
        <LinkTabs
          label="Records"
          tabs={[
            {
              href: href({ legacy: false }),
              label: "2.0",
              current: !board.legacy,
            },
            {
              href: href({ legacy: true }),
              label: "Pre-2.0",
              current: board.legacy,
            },
          ]}
        />
      </div>
    </ChoiceBar>
  );
}

/** The heading of the completions list, which counts maps or bonuses. */
export function completedLabel(track: Track): string {
  return track === "bonuses" ? "Completed bonuses" : "Completed maps";
}
