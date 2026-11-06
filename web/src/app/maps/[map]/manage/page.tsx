// A map's Manage view, for staff, under the map's header. Kept out of search engines, as the staff area is.
import type { Metadata } from "next";
import { ManageMap } from "@/features/staff/maps/ManageMap";
import { PageView } from "@/ui/Page";

export async function generateMetadata({
  params,
}: PageProps<"/maps/[map]/manage">): Promise<Metadata> {
  return {
    title: `Manage ${decodeURIComponent((await params).map)}`,
    robots: { index: false, follow: false },
  };
}

export default function ManageMapPage({
  params,
}: PageProps<"/maps/[map]/manage">) {
  return (
    <PageView>
      {params.then(({ map }) => (
        <ManageMap name={decodeURIComponent(map)} />
      ))}
    </PageView>
  );
}
