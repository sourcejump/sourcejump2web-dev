// Servers page: the servers staff have listed, from their heartbeats.
import type { Metadata } from "next";
import { ServerList } from "@/features/servers/ServerList";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Servers",
  description: "Bhop servers running the SourceJump plugin.",
};

export default function ServersPage() {
  return (
    <Page className="gap-6">
      {/* The board's activity card carries the page's heading, on a phone as on wider screens. */}
      <ServerList />
    </Page>
  );
}
