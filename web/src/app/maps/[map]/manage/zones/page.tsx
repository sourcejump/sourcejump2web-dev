// The zone editor for a map, under its header, for staff with manage_zones. Kept out of search engines, as the
// staff area is.
import type { Metadata } from "next";
import { ZoneEditorView } from "@/features/staff/maps/ZoneEditorView";
import { PageView } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/maps/[map]/manage/zones">): Promise<Metadata> {
  return {
    title: `Zones of ${decodeURIComponent((await params).map)}`,
    robots: { index: false, follow: false },
  };
}

export default function ZoneEditorPage({
  params,
}: PageProps<"/maps/[map]/manage/zones">) {
  return (
    <PageView>
      {params.then(({ map }) => (
        <ZoneEditorView name={decodeURIComponent(map)} />
      ))}
    </PageView>
  );
}
