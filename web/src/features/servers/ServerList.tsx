// The Servers page: activity over time, then the listed servers running the SourceJump plugin, online ones
// first. Staff with manage_servers also see unlisted servers there, and list or unlist them in place.
import { connection } from "next/server";
import { api } from "@/api/client";
import { ServerActivity } from "./ServerActivity";
import { ServerRows } from "./ServerRows";

export async function ServerList() {
  // At request time, as `LiveNow`: the API isn't reachable while the site is built.
  await connection();
  const [result, day, week, month, year] = await Promise.all([
    api.GET("/v1/servers").catch(() => undefined),
    ...(["day", "week", "month", "year"] as const).map((range) =>
      api
        .GET("/v1/servers/activity", { params: { query: { range } } })
        .catch(() => undefined),
    ),
  ]);
  const servers = result?.data?.servers;
  if (!servers) {
    return <p>Servers couldn&apos;t be loaded. Try again in a moment.</p>;
  }
  if (servers.length === 0) return <ServerRows servers={servers} />;

  return (
    <div className="flex flex-col gap-4">
      <ServerActivity
        activity={{
          day: day?.data,
          week: week?.data,
          month: month?.data,
          year: year?.data,
        }}
      />
      <ServerRows servers={servers} />
    </div>
  );
}
