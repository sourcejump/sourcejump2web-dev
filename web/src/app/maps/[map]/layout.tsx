// A map's pages: the banner and header stay while the map's view, its Zones and its Manage view swap beneath them.
import { MapHeader } from "@/features/maps/MapHeader";
import { Page } from "@/ui/Page";

export default function MapLayout({
  params,
  children,
}: LayoutProps<"/maps/[map]">) {
  return (
    <Page className="gap-4">
      {params.then(({ map }) => (
        <MapHeader name={decodeURIComponent(map)} />
      ))}
      {children}
    </Page>
  );
}
