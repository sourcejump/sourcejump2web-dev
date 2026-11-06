// The Activity page's runs: the filter menus, read from and written to the address, and the first page of runs.
import { api } from "@/api/client";
import { tierParam } from "@/features/maps/tierParam";
import { currentStyles } from "@/features/ruleset/styles";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { RecentRunTable, type RunChunks } from "./RecentRunTable";

const tracks = [
  { key: "all", label: "All" },
  { key: "main", label: "Main" },
  { key: "bonus", label: "Bonus" },
] as const;
type Track = (typeof tracks)[number]["key"];

export interface RecentRunsParams {
  style?: string;
  track?: string;
  /** The lowest tier shown. */
  tier?: string;
  /** "records": world records only. */
  show?: string;
  page?: string;
}

const PAGE_SIZE = 15;
/** Runs per request, six pages: ninety cost the API about what fifteen do, so most pages turn without a request. */
const CHUNK = 90;
/** How far an address may walk an API without offsets before giving up, at one request per chunk. */
const MAX_CHUNKS = 20;

type RunsQuery = {
  style?: string;
  track?: "main" | "bonus";
  min_tier?: number;
  records?: boolean;
};

interface Filters {
  style?: string;
  track: Track;
  tier?: number;
  records: boolean;
}

export async function RecentRuns({ params }: { params: RecentRunsParams }) {
  const track = tracks.find((t) => t.key === params.track)?.key ?? "all";
  const tier = tierParam(params.tier);
  const records = params.show === "records";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const queryFor = (style: string | undefined): RunsQuery => ({
    style,
    track: track === "all" ? undefined : track,
    min_tier: tier,
    records: records || undefined,
  });

  // The runs don't wait for the ruleset: the style in the address is almost always one it ranks, and only a
  // stale one costs a second request.
  const [styles, guessed] = await Promise.all([
    currentStyles(),
    loadRuns(queryFor(params.style || undefined), page),
  ]);
  const style = styles.keys.find((key) => key === params.style);
  const query = queryFor(style);
  const first =
    style === (params.style || undefined)
      ? guessed
      : await loadRuns(query, page);
  const filters: Filters = { style, track, tier, records };
  const tierCount = first?.tierCount ?? undefined;

  // Only what differs from the defaults goes in the address, so the plain page stays /activity.
  const href = (choice: Partial<Filters>) => {
    const next = { ...filters, ...choice };
    const search = new URLSearchParams();
    if (next.style) search.set("style", next.style);
    if (next.track !== "all") search.set("track", next.track);
    if (next.tier) search.set("tier", String(next.tier));
    if (next.records) search.set("show", "records");
    const text = search.toString();
    return text ? `/activity?${text}` : "/activity";
  };

  return (
    <div className="flex flex-col">
      <div className="border-border border-y px-4 py-2">
        <ChoiceBar>
          <ChoiceMenu
            label="Show"
            options={[
              {
                value: "all",
                label: "All runs",
                href: href({ records: false }),
              },
              {
                value: "records",
                label: "World records",
                href: href({ records: true }),
              },
            ]}
            value={filters.records ? "records" : "all"}
          />
          {styles.keys.length > 1 && (
            <ChoiceMenu
              label="Style"
              options={[
                { value: "", label: "All", href: href({ style: undefined }) },
                ...styles.keys.map((key) => ({
                  value: key,
                  label: styles.name(key),
                  href: href({ style: key }),
                })),
              ]}
              value={filters.style ?? ""}
            />
          )}
          <ChoiceMenu
            label="Track"
            options={tracks.map((t) => ({
              value: t.key,
              label: t.label,
              href: href({ track: t.key }),
            }))}
            value={filters.track}
          />
          {/* Tiers are the community's to set; until a tier count is published there's nothing to filter by. */}
          {tierCount != null && (
            <ChoiceMenu
              label="Lowest tier"
              options={[
                { value: "", label: "Any", href: href({ tier: undefined }) },
                ...Array.from({ length: tierCount }, (_, i) => ({
                  value: String(i + 1),
                  label: `Tier ${i + 1}`,
                  href: href({ tier: i + 1 }),
                })),
              ]}
              value={filters.tier ? String(filters.tier) : ""}
            />
          )}
        </ChoiceBar>
      </div>

      {!first ? (
        <p className="text-text-muted px-4 py-6">
          Runs couldn&apos;t be loaded. Try again in a moment.
        </p>
      ) : (
        // Keyed by the filters, so a new choice starts again from the newest runs and they all fade in.
        <RecentRunTable
          key={href({})}
          first={first}
          query={{ ...query, limit: CHUNK }}
          address={href({})}
          pageSize={PAGE_SIZE}
          styleNames={Object.fromEntries(
            styles.keys.map((key) => [key, styles.name(key)]),
          )}
          showStyle={!filters.style && styles.keys.length > 1}
        />
      )}
    </div>
  );
}

/** The chunk holding `page`; undefined when the first request fails. */
async function loadRuns(
  query: RunsQuery,
  page: number,
): Promise<RunChunks | undefined> {
  const get = (from: { offset?: number; cursor?: string }) =>
    api
      .GET("/v1/runs", {
        params: { query: { ...query, limit: CHUNK, ...from } },
      })
      .then((result) => result.data)
      .catch(() => undefined);
  const wanted = Math.floor(((page - 1) * PAGE_SIZE) / CHUNK);
  const first = await get({ offset: wanted * CHUNK });
  if (!first) return undefined;
  const tierCount = first.tier_count ?? null;

  // An API that counts its runs honours the offset, so this is the page's own chunk. One past the end is asked
  // again for the last chunk.
  if (typeof first.total === "number") {
    const last = Math.max(0, Math.ceil(first.total / CHUNK) - 1);
    const page = wanted > last ? await get({ offset: last * CHUNK }) : first;
    if (!page) return undefined;
    return {
      chunks: { [Math.min(wanted, last)]: page.runs },
      total: page.total,
      cursor: null,
      tierCount,
    };
  }

  // One that doesn't (the beta before `total`) ignored the offset and sent the newest runs, so walk forward.
  const chunks: Record<number, RunChunks["chunks"][number]> = { 0: first.runs };
  let cursor = first.next_cursor ?? null;
  for (
    let chunk = 1;
    cursor && chunk <= wanted && chunk < MAX_CHUNKS;
    chunk++
  ) {
    const next = await get({ cursor });
    if (!next) break;
    chunks[chunk] = next.runs;
    cursor = next.next_cursor ?? null;
  }
  return { chunks, total: null, cursor, tierCount };
}
