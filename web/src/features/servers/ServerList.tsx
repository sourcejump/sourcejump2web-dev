// The Servers page: activity over time, then the listed servers running the SourceJump plugin, online ones
// first. Staff with manage_servers also see unlisted servers there, and list or unlist them in place. From sm
// up this is one board; combining the chart and the list into one board read badly on a phone, so it keeps
// them as two boards there.
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
  const online = servers?.filter((server) => server.online);

  return (
    <div className="sm:border-border sm:bg-surface flex flex-col gap-4 sm:gap-0 sm:overflow-hidden sm:rounded-lg sm:border">
      <ServerActivity
        heading="Servers"
        live={
          online && {
            servers: online.length,
            players: online.reduce((sum, server) => sum + server.players, 0),
          }
        }
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
        <p className="text-text-muted border-border rounded-lg border p-5 sm:rounded-none sm:border-x-0 sm:border-t sm:border-b-0 sm:px-4 sm:py-6">
          Servers couldn&apos;t be loaded. Try again in a moment.
        </p>
      )}
    </div>
  );
}
