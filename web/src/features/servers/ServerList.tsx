// The Servers page as one board: its title and activity over time, then the listed servers running the
// SourceJump plugin, online ones first. Staff with manage_servers also see unlisted servers there, and list or
// unlist them in place.
import { api } from "@/api/client";
import { ServerActivity } from "./ServerActivity";
import { ServerRows } from "./ServerRows";

export async function ServerList() {
  const [result, day, week, month, year] = await Promise.all([
    api.GET("/v1/servers").catch(() => undefined),
    ...(["day", "week", "month", "year"] as const).map((range) =>
      api
        .GET("/v1/servers/activity", { params: { query: { range } } })
        .catch(() => undefined),
    ),
  ]);
  const servers = result?.data?.servers;

  return (
    <div className="border-border bg-surface overflow-hidden rounded-lg border">
      <ServerActivity
        heading="Servers"
        activity={
          servers && servers.length > 0
            ? {
                day: day?.data,
                week: week?.data,
                month: month?.data,
                year: year?.data,
              }
            : {}
        }
      />
      {servers ? (
        <ServerRows servers={servers} />
      ) : (
        <p className="text-text-muted border-border border-t px-4 py-6">
          Servers couldn&apos;t be loaded. Try again in a moment.
        </p>
      )}
    </div>
  );
}
