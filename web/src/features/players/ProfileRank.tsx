"use client";
// A player's rank, large in their profile header: the points leaderboard place in the style the profile shows (its
// Style and Track choices, read from the address), so it follows those menus below without a page load.
import { useSearchParams } from "next/navigation";
import type { Schemas } from "@/api/client";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";

/** Rank 1 to 3 in the medal colors, as on the boards. */
const medalText = ["text-gold", "text-silver", "text-bronze"];
const numbers = new Intl.NumberFormat("en");

export function ProfileRank({
  styles,
  styleOrder,
  styleNames,
  draft,
  inline = false,
}: {
  /** The player's styles, from their profile. */
  styles: Pick<
    Schemas["PlayerStyle"],
    "style" | "main_standing" | "bonus_standing"
  >[];
  /** Style keys in the ruleset's order. */
  styleOrder: string[];
  styleNames: Record<string, string>;
  /** Whether the points formula is still a draft, marked beside the points (lead, 2026-10-20). */
  draft: boolean;
  /** One line under the name, as a phone shows it, rather than the large block at the header's end. */
  inline?: boolean;
}) {
  const params = useSearchParams();
  const bonuses = params.get("tracks") === "bonuses";
  const standingOf = (style: (typeof styles)[number]) =>
    bonuses ? style.bonus_standing : style.main_standing;
  const ordered = [...styles].sort(
    (a, b) => orderOf(styleOrder, a.style) - orderOf(styleOrder, b.style),
  );
  // The style the profile shows: the one chosen, or with none, the first they have times in, as the profile opens
  // on. For "any" style, the first they're ranked in.
  const key = params.get("style");
  const chosen =
    ordered.find((style) => style.style === key) ??
    // A ranked style they have no times in: shown as such, rather than another style's rank.
    (key && styleOrder.includes(key)
      ? { style: key, main_standing: null, bonus_standing: null }
      : undefined);
  const shown =
    chosen ??
    (key === "any" ? ordered.find((style) => standingOf(style)) : undefined) ??
    ordered[0];
  if (!shown) return null;
  const standing = standingOf(shown);
  const name = styleNames[shown.style] ?? shown.style;
  const query = new URLSearchParams({
    ...(shown.style !== styleOrder[0] && { style: shown.style }),
    ...(bonuses && { track: "bonuses" }),
  }).toString();

  const number = (
    <span
      className={classNames(
        "leading-none font-bold tabular-nums transition-colors duration-(--duration-fast)",
        inline ? "text-2xl" : "text-4xl",
        standing
          ? (medalText[standing.rank - 1] ?? "group-hover:text-accent")
          : "text-text-subtle",
      )}
    >
      {standing ? (
        <>
          <span className="font-normal">#</span>
          {standing.rank}
        </>
      ) : (
        "—"
      )}
    </span>
  );
  const style = (
    <span className="text-text group-hover:text-accent font-bold transition-colors duration-(--duration-fast)">
      {name}
      {bonuses && " bonuses"}
    </span>
  );
  const points = standing
    ? `${numbers.format(standing.points)} points${draft ? " · draft" : ""}`
    : "No points yet";
  const href = `/leaderboards/points${query ? `?${query}` : ""}`;

  return inline ? (
    <Link href={href} className="group flex items-baseline gap-2 text-sm">
      {number}
      <span className="min-w-0">
        {style}
        <span className="text-text-muted"> · {points}</span>
      </span>
    </Link>
  ) : (
    <Link href={href} className="group flex items-end gap-3">
      {number}
      <span className="flex flex-col pb-0.5 text-sm leading-tight">
        {style}
        <span className="text-text-muted">{points}</span>
      </span>
    </Link>
  );
}

/** A style's place in the ruleset's order; styles it no longer ranks after. */
function orderOf(keys: string[], style: string): number {
  const index = keys.indexOf(style);
  return index === -1 ? keys.length : index;
}
