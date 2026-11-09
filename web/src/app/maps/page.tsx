// Maps page: every map with a finished run, searchable, with its world record in a chosen style.
import type { Metadata } from "next";
import { MapList } from "@/features/maps/MapList";
import { SectionTitle } from "@/features/site/SectionTitle";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Maps",
  description: "Every map with a SourceJump run, and its world record.",
};

export default function MapsPage({ searchParams }: PageProps<"/maps">) {
  return (
    <Page className="gap-6">
      <SectionTitle>Maps</SectionTitle>
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
