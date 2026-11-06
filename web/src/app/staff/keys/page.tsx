// Staff: server API keys.
import type { Metadata } from "next";
import { IssueKey } from "@/features/staff/keys/IssueKey";
import { KeyList } from "@/features/staff/keys/KeyList";
import { Page } from "@/ui/Page";

export const metadata: Metadata = { title: "API keys" };

export default function StaffKeysPage() {
  return (
    <Page width="fill" className="gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">API keys</h1>
        <IssueKey />
      </div>
      <KeyList />
    </Page>
  );
}
