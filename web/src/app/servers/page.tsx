// Servers page: the servers staff have listed, from their heartbeats.
import type { Metadata } from "next";
import { ServerList } from "@/features/servers/ServerList";
import { SectionTitle } from "@/features/site/SectionTitle";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Servers",
  description: "Bhop servers running the SourceJump plugin.",
};

export default function ServersPage() {
  return (
    <Page className="gap-6">
      <SectionTitle>Servers</SectionTitle>
      <ServerList />
    </Page>
  );
}
