// The Activity page's runs: the filter menus, read from and written to the address, and the first page of runs.
import { api } from "@/api/client";
import { currentStyles } from "@/features/ruleset/styles";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { RecentRunTable } from "./RecentRunTable";

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
}

interface Filters {
  style?: string;
  track: Track;
  tier?: number;
  records: boolean;
}

export async function RecentRuns({ params }: { params: RecentRunsParams }) {
  const styles = await currentStyles();
  const filters: Filters = {
    style: styles.keys.find((key) => key === params.style),
    track: tracks.find((t) => t.key === params.track)?.key ?? "all",
    tier: Math.floor(Number(params.tier)) || undefined,
    records: params.show === "records",
  };
  const query = {
    style: filters.style,
    track: filters.track === "all" ? undefined : filters.track,
    min_tier: filters.tier,
    records: filters.records || undefined,
    limit: 15,
  };
  const result = await api
    .GET("/v1/runs", { params: { query } })
    .catch(() => undefined);
  const first = result?.data;
  const tierCount = first?.tier_count ?? undefined;

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
          query={query}
          styleNames={Object.fromEntries(
            styles.keys.map((key) => [key, styles.name(key)]),
          )}
          showStyle={!filters.style && styles.keys.length > 1}
        />
      )}
    </div>
  );
}
