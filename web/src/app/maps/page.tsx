// Maps page: every map with a finished run, searchable, with its world record in a chosen style. MapList sets out
// the page, title included, since the count beside the title comes with the list.
import type { Metadata } from "next";
import { MapList } from "@/features/maps/MapList";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Maps",
  description: "Every map with a SourceJump run, and its world record.",
};

export default function MapsPage({ searchParams }: PageProps<"/maps">) {
  return (
    <Page width="fill" className="gap-3 px-5 pt-4 pb-8">
      {searchParams.then((params) => (
        <MapList params={firstValues(params)} />
      ))}
    </Page>
  );
}

/** A repeated query parameter counts by its first value. */
function firstValues(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}
