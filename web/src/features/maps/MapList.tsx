// The Maps page's totals (maps, tiered maps, maps per tier), its search, sort, style and completion choices,
// and one row per map with its picture, tier and world record. Staff who manage maps also get a "No runs yet" tab
// and a "Map files" tab for uploading viewer files in bulk, and can set up a map by name before its first run.
import { Search, X } from "lucide-react";
import Form from "next/form";
import type { CSSProperties } from "react";
import { api, type Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { STEAMID } from "@/features/players/steamId";
import { formatSince, formatTime } from "@/features/runs/time";
import { BulkUpload } from "@/features/staff/maps/BulkUpload";
import { UnplayedMaps } from "@/features/staff/maps/UnplayedMaps";
import { Avatar } from "@/ui/Avatar";
import { Button, ButtonLink } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Flag } from "@/ui/Flag";
import { Input } from "@/ui/Input";
import { Link } from "@/ui/Link";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { LinkTabs } from "@/ui/LinkTabs";
import { Pager } from "@/ui/Pager";
import { TierBadge } from "@/ui/TierBadge";
import { TierSpread } from "@/ui/TierSpread";
import { managesMaps } from "./MapHeader";
import { MapImage } from "./MapImage";
import { MAP_NAME } from "./mapName";
import { tierParam } from "./tierParam";

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
    <div className="flex flex-col gap-6">
      {list && (
        <MapStats
          stats={list.stats}
          tierCount={list.tier_count}
          selected={tier}
          tierHref={(choice) => href({ tier: choice })}
          newestHref={href({ sort: "newest", tier: null, page: 1 })}
        />
      )}
      <Form action="/maps" prefetch={false} className="flex max-w-xl gap-2">
        {/* Searching keeps the chosen tab, sort, style and completion filter. */}
        {unplayed && <input type="hidden" name="view" value="unplayed" />}
        {completion !== "all" && filterPlayer && (
          <>
            <input type="hidden" name="player" value={filterPlayer} />
            <input type="hidden" name="completed" value={completion} />
          </>
        )}
        {sort !== DEFAULT_SORT && (
          <input type="hidden" name="sort" value={sort} />
        )}
        {requestedStyle && (
          <input type="hidden" name="style" value={requestedStyle} />
        )}
        {tier != null && <input type="hidden" name="tier" value={tier} />}
        <Input
          icon={Search}
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Map name, or a SteamID for their maps"
          aria-label="Search maps, or enter a SteamID"
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </Form>

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
                  ? "No map with a run has that name."
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
        <>
          {/* Keyed by what's shown, so a new sort or style remounts every row and they all enter together;
              keyed by map alone, rows that stay on the page would swap in place without moving. */}
          <ul key={href({ page })} className="flex flex-col gap-2">
            {list.maps.map((map, index) => (
              <li
                key={map.name}
                className="motion-enter"
                style={
                  {
                    "--motion-delay": `${Math.min(index, 12) * 25}ms`,
                  } as CSSProperties
                }
              >
                <MapRow map={map} tierCount={list.tier_count} />
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            pageCount={Math.ceil(list.total / PAGE_SIZE)}
            total={list.total}
            noun={list.total === 1 ? "map" : "maps"}
            href={(p) => href({ page: p })}
          />
        </>
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
  const hasTiers = stats.by_tier.length > 0;
  if (
    !hasTiers &&
    stats.newest.length === 0 &&
    stats.played_this_week.length === 0
  )
    return null;
  // The chart keeps the width it needs; the lists share what is left equally, each with a full-height divider.
  return (
    <Card className="flex flex-col gap-6 py-4 lg:flex-row lg:gap-10">
      {hasTiers && (
        <TierSpread
          byTier={stats.by_tier}
          untiered={stats.maps - tiered}
          selected={selected}
          tierHref={tierHref}
        />
      )}
      {stats.newest.length > 0 && (
        <MapStatsList
          title="New"
          href={newestHref}
          maps={stats.newest.map((map) => ({
            name: map.name,
            tier: map.tier,
            detail: formatSince(map.listed_at),
          }))}
          tierCount={tierCount}
        />
      )}
      {stats.played_this_week.length > 0 && (
        <MapStatsList
          title="Played this week"
          maps={stats.played_this_week.map((map) => ({
            name: map.name,
            tier: map.tier,
            detail: `${number.format(map.players)} ${map.players === 1 ? "player" : "players"}`,
          }))}
          tierCount={tierCount}
        />
      )}
    </Card>
  );
}

/** One of the map stats' lists: a heading, linked to the matching sort if there is one, then a few maps with a detail each. */
function MapStatsList({
  title,
  href,
  maps,
  tierCount,
}: {
  title: string;
  href?: string;
  maps: { name: string; tier?: number | null; detail: string }[];
  tierCount: number | null | undefined;
}) {
  return (
    <section className="border-border flex min-w-0 flex-1 basis-0 flex-col gap-2 lg:border-l lg:pl-10">
      <h2 className="text-text-muted text-xs tracking-widest uppercase">
        {href ? (
          <Link href={href} className="hover:text-text">
            {title}
          </Link>
        ) : (
          title
        )}
      </h2>
      <ul className="flex flex-col gap-0.5 text-sm">
        {maps.map((map) => (
          <li key={map.name}>
            <Link
              href={`/maps/${map.name}`}
              className="hover:bg-surface-raised -mx-2 flex items-center gap-2 rounded-md px-2 py-0.5"
            >
              {map.tier != null && tierCount != null && (
                <TierBadge tier={map.tier} tierCount={tierCount} />
              )}
              <span className="min-w-0 flex-1 truncate font-semibold">
                {map.name}
              </span>
              <span className="text-text-subtle shrink-0">{map.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
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
          <Avatar
            name={player.name}
            src={player.avatar_url ?? undefined}
            size="sm"
          />
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

function MapRow({
  map,
  tierCount,
}: {
  map: Schemas["MapSummary"];
  tierCount: number | null | undefined;
}) {
  const wr = map.world_record;
  return (
    <Link
      href={`/maps/${map.name}`}
      className="border-border bg-surface motion-lift flex items-center gap-4 rounded-lg border p-2 pr-4"
    >
      <MapImage image={map.image} size="thumbnail" />
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex items-center gap-2">
          {map.tier != null && tierCount != null && (
            <TierBadge tier={map.tier} tierCount={tierCount} />
          )}
          <span className="truncate font-bold">{map.name}</span>
        </span>
        <span className="text-text-subtle text-sm">
          {map.players === 1 ? "1 player" : `${map.players} players`}
          {map.bonuses > 0 &&
            ` · ${map.bonuses === 1 ? "1 bonus" : `${map.bonuses} bonuses`}`}
        </span>
      </span>
      {wr ? (
        <span className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-accent font-bold tabular-nums">
            {formatTime(wr.time)}
          </span>
          <span className="text-text-muted flex items-center gap-1.5 text-sm">
            {wr.player.name}
            <Flag code={wr.player.country_code} />
          </span>
        </span>
      ) : (
        <span className="text-text-subtle text-sm">
          No record in this style
        </span>
      )}
    </Link>
  );
}
