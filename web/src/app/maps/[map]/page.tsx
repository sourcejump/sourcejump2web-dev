// A map's page: its description, leaderboards per style and track, and their WR history, under the map's header.
import type { Metadata } from "next";
import { MapView } from "@/features/maps/MapView";
import { PageView } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/maps/[map]">): Promise<Metadata> {
  return { title: decodeURIComponent((await params).map) };
}

export default function MapPage({ params }: PageProps<"/maps/[map]">) {
  return (
    <PageView>
      {params.then(({ map }) => (
        <MapView name={decodeURIComponent(map)} />
      ))}
    </PageView>
  );
}
