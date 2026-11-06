// A map's Zones view, for everyone, under the map's header.
import type { Metadata } from "next";
import { MapZones } from "@/features/maps/MapZones";
import { PageView } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/maps/[map]/zones">): Promise<Metadata> {
  return { title: `Zones of ${decodeURIComponent((await params).map)}` };
}

export default function MapZonesPage({
  params,
}: PageProps<"/maps/[map]/zones">) {
  return (
    <PageView>
      {params.then(({ map }) => (
        <MapZones name={decodeURIComponent(map)} />
      ))}
    </PageView>
  );
}
