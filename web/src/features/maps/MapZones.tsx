// A map's Zones view, for everyone, under its header: the zones servers load, from above, and the same 3D view
// staff edit them in, without the editing.
import { notFound } from "next/navigation";
import { api } from "@/api/client";
import { Card, Label } from "@/ui/Card";
import { getMap } from "./mapDetail";
import { MapZoneView } from "./MapZoneView";

export async function MapZones({ name }: { name: string }) {
  const [result, zones] = await Promise.all([
    getMap(name),
    api
      .GET("/v1/maps/{map}/zones", { params: { path: { map: name } } })
      .catch(() => undefined),
  ]);
  if (result?.response.status === 404 || result?.response.status === 422) {
    notFound();
  }
  const map = result?.data;
  if (!map || (!zones?.data && zones?.response.status !== 404)) {
    return <p>The zones couldn&apos;t be loaded. Try again in a moment.</p>;
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label>Zones</Label>
        <p className="text-text-muted text-sm">
          {zones.data
            ? "The zones servers load on this map."
            : "SourceJump has no zones for this map yet."}
        </p>
      </div>
      {zones.data && (
        <MapZoneView
          map={map.name}
          zones={zones.data}
          viewerFile={map.viewer_file ?? null}
          tracks={map.tracks.map((track) => track.track)}
          cover={map.images[0]}
        />
      )}
    </Card>
  );
}
