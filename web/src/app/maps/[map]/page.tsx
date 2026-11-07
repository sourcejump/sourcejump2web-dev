// A map's page: its description, leaderboards per style and track, and their WR history, under the map's header.
import type { Metadata } from "next";
import { getMap } from "@/features/maps/mapDetail";
import { mapPreview } from "@/features/maps/mapPreview";
import { MapView } from "@/features/maps/MapView";
import { currentStyles } from "@/features/ruleset/styles";
import { PageView } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/maps/[map]">): Promise<Metadata> {
  const name = decodeURIComponent((await params).map);
  // The same reads as the page's own (`getMap` is per request), so the preview costs no extra request.
  const [result, styles] = await Promise.all([getMap(name), currentStyles()]);
  const map = result?.data;
  return map ? mapPreview(map, styles.keys, styles.name) : { title: name };
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
