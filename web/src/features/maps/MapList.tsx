// The Maps page's totals (maps, tiered maps, maps per tier), its search, sort, style and completion choices,
// and one card per map with its picture, tier and top three. Staff who manage maps also get a "No runs yet" tab
// and a "Map files" tab for uploading viewer files in bulk, and can set up a map by name before its first run.
import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { api, type Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { STEAMID } from "@/features/players/steamId";
import { formatSince } from "@/features/runs/time";
import { BulkUpload } from "@/features/staff/maps/BulkUpload";
import { UnplayedMaps } from "@/features/staff/maps/UnplayedMaps";
import { Avatar } from "@/ui/Avatar";
import { ButtonLink } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import { SearchField } from "@/ui/SearchField";
import { Link } from "@/ui/Link";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { LinkTabs } from "@/ui/LinkTabs";
import { Pager } from "@/ui/Pager";
import { TierBadge } from "@/ui/TierBadge";
import { TierSpread } from "@/ui/TierSpread";
import { managesMaps } from "./MapHeader";
import { MapCard } from "./MapCard";
import { mapPodiums } from "./mapPodiums";
import cardStyles from "./MapCard.module.css";
import overviewStyles from "./MapOverview.module.css";
import { MAP_NAME } from "./mapName";
import { tierParam } from "./tierParam";
import { avatarSrc } from "@/features/players/avatarSrc";

const PAGE_SIZE = 50;
/** In groups (players, name, tier, record), each starting below a line in the menu. */
const sorts = [
  { key: "popular", label: "Most players" },
  { key: "least_popular", label: "Fewest players" },
  { key: "recent", label: "Recently played" },
  { key: "newest", label: "Newest maps" },
  { key: "name", label: "A–Z", startsGroup: true },
  { key: "name_desc", label: "Z–A" },
  { key: "hardest", label: "Tier, high to low", startsGroup: true },
  { key: "easiest", label: "Tier, low to high" },
  { key: "longest_record", label: "Longest record", startsGroup: true },
  { key: "shortest_record", label: "Shortest record" },
  { key: "newest_record", label: "Newest record" },
  { key: "oldest_record", label: "Oldest record" },
] as const;
type Sort = (typeof sorts)[number]["key"];
/** Busiest maps first (lead, 2026-10-26). */
const DEFAULT_SORT: Sort = "popular";
/** A Steam profile link, which the search also reads as the player it points to. */
const PROFILE_LINK = /steamcommunity\.com\/profiles\/(\d{17})/;
const completions = [
  { key: "all", label: "All maps" },
  { key: "yes", label: "Completed" },
  { key: "no", label: "Not completed" },
] as const;
type Completion = (typeof completions)[number]["key"];

export interface MapListParams {
  q?: string;
  sort?: string;
  style?: string;
  page?: string;
  /** "unplayed": the staff tab of maps nobody has finished; "files": the staff tab for uploading viewer files. */
  view?: string;
  /** A SteamID: whose completions `completed` filters by. */
  player?: string;
  /** "yes" or "no", with `player`. */
  completed?: string;
  /** Only maps whose main track has this tier. */
  tier?: string;
}

export async function MapList({ params }: { params: MapListParams }) {
  const typed = params.q?.trim() ?? "";
  // A SteamID in the search box asks for that player's maps, most usefully the ones they haven't finished.
  // It's read in place rather than redirected, so searching stays a single soft navigation.
  const searchedPlayer = STEAMID.test(typed)
    ? typed
    : PROFILE_LINK.exec(typed)?.[1];
  const q = searchedPlayer ? "" : typed;
  const sort: Sort = sorts.some((s) => s.key === params.sort)
    ? (params.sort as Sort)
    : DEFAULT_SORT;
  const page = Math.max(1, Math.floor(Number(params.page ?? 1)) || 1);
  const player = searchedPlayer ?? (params.player?.trim() || undefined);
  const completion: Completion = searchedPlayer
    ? "no"
    : player && (params.completed === "yes" || params.completed === "no")
      ? params.completed
      : "all";
  const tier = tierParam(params.tier);
  const [styles, me] = await Promise.all([currentStyles(), signedInPlayer()]);
  const staff = managesMaps(me?.privileges);
  const unplayed = staff && params.view === "unplayed";
  const files = staff && params.view === "files";
  const staffTabs = staff && (
    <LinkTabs
      label="Maps"
      tabs={[
        {
          href: "/maps",
          label: "On the list",
          current: !unplayed && !files,
        },
        {
          href: "/maps?view=unplayed",
          label: "No runs yet",
          current: unplayed,
        },
        { href: "/maps?view=files", label: "Map files", current: files },
      ]}
    />
  );
  // Only the tabs and the upload: searching and sorting don't apply to files on the staff member's computer.
  if (files) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold">Maps</h1>
        <ChoiceBar>
          <div className="ml-auto">{staffTabs}</div>
        </ChoiceBar>
        <BulkUpload />
      </div>
    );
  }
  const requestedStyle =
    params.style && styles.keys.includes(params.style)
      ? params.style
      : undefined;
  // The staff tab reads its own list.
  const result = unplayed
    ? undefined
    : await api
        .GET("/v1/maps", {
          params: {
            query: {
              q: q || undefined,
              sort,
              style: requestedStyle,
              // Sent without a completion filter too, for the menu's counts of the signed-in player's maps.
              player: completion === "all" ? me?.steamid64 : player,
              completed:
                completion === "all" ? undefined : completion === "yes",
              tier,
              limit: PAGE_SIZE,
              offset: (page - 1) * PAGE_SIZE,
            },
          },
        })
        .catch(() => undefined);
  const list = result?.data;
  const style = list?.style ?? requestedStyle;
  const podiums = await mapPodiums(list?.maps ?? [], style, me?.steamid64);
  const typedName = q.toLowerCase();
  const offerSetUp =
    staff &&
    MAP_NAME.test(typedName) &&
    !list?.maps.some((map) => map.name === typedName);

  // Whose completions the menu filters by: the chosen player (as a SteamID64 once known, whatever form was
  // typed), or else the signed-in one.
  const filterPlayer =
    completion === "all" ? me?.steamid64 : (list?.player?.steamid64 ?? player);
  const href = (choice: {
    sort?: Sort;
    style?: string;
    completion?: Completion;
    /** null clears the tier filter. */
    tier?: number | null;
    page?: number;
  }) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    const chosenTier = choice.tier === undefined ? tier : choice.tier;
    if (chosenTier != null) query.set("tier", String(chosenTier));
    if (unplayed) query.set("view", "unplayed");
    const chosenCompletion = choice.completion ?? completion;
    if (chosenCompletion !== "all" && filterPlayer) {
      query.set("player", filterPlayer);
      query.set("completed", chosenCompletion);
    }
    const chosenSort = choice.sort ?? sort;
    if (chosenSort !== DEFAULT_SORT) query.set("sort", chosenSort);
    const chosenStyle = choice.style ?? style;
    if (chosenStyle && chosenStyle !== styles.keys[0]) {
      query.set("style", chosenStyle);
    }
    if (choice.page && choice.page > 1) query.set("page", String(choice.page));
    const text = query.toString();
    return text ? `/maps?${text}` : "/maps";
  };

  const completedShare = (count: number) =>
    list?.stats.maps
      ? `${share.format(count / list.stats.maps)} · ${number.format(count)}`
      : undefined;
  const completionDetail: Record<Completion, string | undefined> =
    list?.completed == null
      ? { all: undefined, yes: undefined, no: undefined }
      : {
          all: number.format(list.stats.maps),
          yes: completedShare(list.completed),
          no: completedShare(list.stats.maps - list.completed),
        };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Maps</h1>
      {list && (
        <Card className="w-full min-w-0 xl:w-fit xl:self-center">
          <MapStats
            stats={list.stats}
            tierCount={list.tier_count}
            selected={tier}
            tierHref={(choice) => href({ tier: choice })}
            newestHref={href({ sort: "newest", page: 1 })}
          />
        </Card>
      )}

      <div className={overviewStyles.toolbar}>
        <ChoiceBar>
          {!unplayed && (
            <>
              <ChoiceMenu
                label="Sort"
                options={sorts.map((s) => ({
                  value: s.key,
                  label: s.label,
                  startsGroup: "startsGroup" in s,
                  href: href({ sort: s.key }),
                }))}
                value={sort}
              />
              {styles.keys.length > 1 && (
                <ChoiceMenu
                  label="Records in"
                  options={styles.keys.map((key) => ({
                    value: key,
                    label: styles.name(key),
                    href: href({ style: key }),
                  }))}
                  value={style ?? styles.keys[0] ?? ""}
                />
              )}
              <ChoiceMenu
                label="Completion"
                options={completions.map((c) => ({
                  value: c.key,
                  label: c.label,
                  detail: completionDetail[c.key],
                  href: href({ completion: c.key }),
                  disabled: c.key !== "all" && !filterPlayer,
                }))}
                value={completion}
              />
              {completion !== "all" && player && (
                <FilterPlayer
                  player={list?.player}
                  steamid={player}
                  clearHref={href({ completion: "all" })}
                />
              )}
            </>
          )}
          {/* Staff only, out of the way of the menus everyone uses. */}
          {staff && <div className="ml-auto">{staffTabs}</div>}
        </ChoiceBar>
        <SearchField
          key={q}
          live
          name="q"
          defaultValue={q}
          placeholder="Map name, WR holder or SteamID"
          label="Search maps, WR holders, or enter a SteamID"
          className={overviewStyles.search}
        />
      </div>

      {/* With no results, the empty card below offers this instead. */}
      {offerSetUp && list && list.maps.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-text-muted text-sm">
            No map on the list is called {typedName}. Its Manage view works
            before anyone runs it, so its zones can be ready first.
          </span>
          <ButtonLink href={`/maps/${typedName}/manage`} size="sm">
            Manage {typedName}
          </ButtonLink>
        </Card>
      )}

      {unplayed ? (
        <UnplayedMaps q={q} page={page} href={(p) => href({ page: p })} />
      ) : !list ? (
        <p>Maps couldn&apos;t be loaded. Try again in a moment.</p>
      ) : list.maps.length === 0 ? (
        <Card className="text-text-muted flex flex-wrap items-center justify-between gap-3">
          <span>
            {completion === "yes"
              ? "No map here has been completed by this player."
              : completion === "no"
                ? "This player has completed every map here."
                : q
                  ? "No maps match that name or WR holder."
                  : tier != null
                    ? `No map with a run has tier ${tier}.`
                    : "No map has a finished run yet."}
          </span>
          {offerSetUp && (
            <ButtonLink href={`/maps/${typedName}/manage`} size="sm">
              Manage {typedName}
            </ButtonLink>
          )}
        </Card>
      ) : (
        <section className="@container">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
            <h2 className="text-xl font-bold">
              {q
                ? `Maps matching “${q}”`
                : tier != null
                  ? `Tier ${tier} maps`
                  : "All maps"}
            </h2>
            <p className="text-text-subtle text-sm">
              {number.format(list.total)} maps in this view
            </p>
          </div>
          <ul
            key={href({ page })}
            className={classNames("grid gap-4", cardStyles.cards)}
          >
            {list.maps.map((map, index) => (
              <li
                key={map.name}
                className="motion-enter min-w-0"
                style={
                  {
                    "--motion-delay": `${Math.min(index, 12) * 25}ms`,
                  } as CSSProperties
                }
              >
                <MapCard
                  map={map}
                  tierCount={list.tier_count}
                  leaders={podiums.get(map.name)?.entries ?? null}
                  showPersonalBest={me != null}
                  personalBest={podiums.get(map.name)?.personalBest}
                  styleName={style ? styles.name(style) : "this style"}
                  styleKey={
                    style && style !== styles.keys[0] ? style : undefined
                  }
                />
              </li>
            ))}
          </ul>
          {list.total > PAGE_SIZE && (
            <div className="border-border mt-4 border-t pt-2">
              <Pager
                page={page}
                pageCount={Math.ceil(list.total / PAGE_SIZE)}
                total={list.total}
                noun={list.total === 1 ? "map" : "maps"}
                href={(p) => href({ page: p })}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const number = new Intl.NumberFormat("en");
const share = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** The whole list at a glance: how the tiers spread, each tier a filter, the maps that joined last and the week's most played. */
function MapStats({
  stats,
  tierCount,
  selected,
  tierHref,
  newestHref,
}: {
  stats: Schemas["MapStats"];
  tierCount: number | null | undefined;
  selected: number | undefined;
  tierHref: (tier: number | null) => string;
  newestHref: string;
}) {
  const tiered = stats.by_tier.reduce((sum, count) => sum + count, 0);
  const hasTiers = stats.by_tier.length > 0 && stats.maps > 0;
  const newest = stats.newest.filter(
    (map) => selected == null || map.tier === selected,
  );
  const playedThisWeek = stats.played_this_week.filter(
    (map) => selected == null || map.tier === selected,
  );
  if (!hasTiers && newest.length === 0 && playedThisWeek.length === 0)
    return null;
  const weeklyScoped =
    selected == null ||
    stats.tier === selected ||
    stats.played_this_week.length < 5 ||
    playedThisWeek.length === 5;
  const hasWeekly = stats.maps > 0;
  return (
    <div
      role="region"
      aria-label="Map overview"
      className={overviewStyles.overview}
    >
      {hasTiers && (
        <div className="flex min-w-0 items-center justify-center">
          <TierSpread
            byTier={stats.by_tier}
            untiered={stats.maps - tiered}
            selected={selected}
            tierHref={tierHref}
          />
        </div>
      )}
      <div className={overviewStyles.summaries}>
        <MapStatsList
          title="New"
          empty="No maps to show"
          href={newestHref}
          maps={newest.map((map) => ({
            name: map.name,
            tier: map.tier,
            detail: formatSince(map.listed_at),
          }))}
          tierCount={tierCount}
        />
        {hasWeekly && (
          <MapStatsList
            title="Played this week"
            empty={
              weeklyScoped
                ? "No maps played in the last seven days."
                : "Weekly activity for this tier could not be loaded."
            }
            maps={(weeklyScoped ? playedThisWeek : []).map((map) => ({
              name: map.name,
              tier: map.tier,
              detail: `${number.format(map.players)} ${map.players === 1 ? "player" : "players"}`,
            }))}
            tierCount={tierCount}
          />
        )}
      </div>
    </div>
  );
}

/** One of the map stats' lists: a heading, linked to the matching sort if there is one, then a few maps with a detail each. */
function MapStatsList({
  title,
  empty,
  href,
  maps,
  tierCount,
}: {
  title: string;
  empty?: string;
  href?: string;
  maps: { name: string; tier?: number | null; detail: string }[];
  tierCount: number | null | undefined;
}) {
  return (
    <section aria-label={title} className={overviewStyles.summary}>
      <h2 className="text-sm font-bold">
        {href ? (
          <Link href={href} className="hover:text-accent">
            {title}
          </Link>
        ) : (
          title
        )}
      </h2>
      {maps.length === 0 ? (
        <p className="text-text-muted text-sm">{empty}</p>
      ) : (
        <ul className={overviewStyles.list}>
          {maps.map((map) => (
            <li key={map.name} className="min-w-0">
              <Link
                href={`/maps/${map.name}`}
                className={classNames(
                  "group rounded-sm text-sm",
                  overviewStyles.link,
                )}
              >
                {map.tier != null && tierCount != null ? (
                  <TierBadge tier={map.tier} tierCount={tierCount} />
                ) : (
                  <span />
                )}
                <span className="group-hover:text-accent max-xs:text-xs min-w-0 wrap-anywhere underline-offset-4 group-hover:underline">
                  {map.name}
                </span>
                <span
                  className={classNames(
                    "text-text-muted text-xs tabular-nums",
                    overviewStyles.detail,
                  )}
                >
                  {map.detail}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Who the list is filtered by, with a way to stop. Shows the SteamID for an account that has never played. */
function FilterPlayer({
  player,
  steamid,
  clearHref,
}: {
  player: Schemas["PlayerRef"] | null | undefined;
  steamid: string;
  clearHref: string;
}) {
  const name = player?.name ?? steamid;
  return (
    <span className="border-border bg-surface inline-flex h-9 items-center gap-2 rounded-md border pr-1 pl-2 text-sm">
      {player ? (
        <Link
          href={`/players/${player.steamid64}`}
          className="hover:text-accent flex items-center gap-2"
        >
          <Avatar name={player.name} src={avatarSrc(player)} size="sm" />
          {player.name}
        </Link>
      ) : (
        <span className="tabular-nums">{steamid}</span>
      )}
      <Link
        href={clearHref}
        aria-label={`Stop filtering by ${name}`}
        className="text-text-muted hover:text-text hover:bg-surface-raised rounded-sm p-1"
      >
        <X aria-hidden className="size-4" />
      </Link>
    </span>
  );
}
