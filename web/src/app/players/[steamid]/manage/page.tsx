// A player's Manage view, for staff, under their header. Kept out of search engines, as the staff area is.
import type { Metadata } from "next";
import { ManagePlayer } from "@/features/staff/players/ManagePlayer";
import { PageView } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Manage player",
  robots: { index: false, follow: false },
};

export default function ManagePlayerPage({
  params,
}: PageProps<"/players/[steamid]/manage">) {
  return (
    <PageView>
      {params.then(({ steamid }) => (
        <ManagePlayer steamid={decodeURIComponent(steamid)} />
      ))}
    </PageView>
  );
}
