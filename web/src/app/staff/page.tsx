// The staff area's first page: the staff log, newest first.
import type { Metadata } from "next";
import { logKind, StaffLogList } from "@/features/staff/StaffLogList";
import { Page } from "@/ui/Page";

export const metadata: Metadata = { title: "Logs" };

export default function StaffPage({ searchParams }: PageProps<"/staff">) {
  return (
    <Page width="fill" className="gap-6">
      <h1 className="text-3xl font-bold">Logs</h1>
      {searchParams.then(({ before, after, kind, about }) => (
        <StaffLogList
          page={{
            before: typeof before === "string" ? before : undefined,
            after: typeof after === "string" ? after : undefined,
            kind: logKind(typeof kind === "string" ? kind : undefined),
            about: typeof about === "string" ? about : undefined,
          }}
        />
      ))}
    </Page>
  );
}
