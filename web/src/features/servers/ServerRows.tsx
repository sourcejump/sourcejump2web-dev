"use client";
// The Servers page's list. Everyone gets the listed servers rendered on the server; staff who hold
// manage_servers then get every server from the browser, unlisted ones included, with their tools. A
// Public / Whitelist switch shows whitelist servers apart, filtered here so the page's
// server render is the same whichever is picked. Nothing caches that render yet; it is built per request.
import { useSearchParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { StaffServerRow } from "@/features/staff/servers/StaffServerRow";
import { useStaffServers } from "@/features/staff/servers/useStaffServers";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { classNames } from "@/ui/classNames";
import { LinkTabs } from "@/ui/LinkTabs";
import { ServerRow } from "./ServerRow";

export function ServerRows({
  servers,
}: {
  servers: Schemas["ListedServer"][];
}) {
  const staff = useStaffServers();
  const whitelist = useSearchParams().get("view") === "whitelist";

  if (staff) {
    if (staff.servers.length === 0) {
      return <Note>No server has sent a heartbeat or been listed yet.</Note>;
    }
    // A server listed before it was ever heard from has no mark to read, so it stays under Public.
    const marked = (server: Schemas["StaffServer"]) =>
      server.server?.whitelist ?? false;
    const shown = staff.servers
      .filter((server) => marked(server) === whitelist)
      .sort(
        (a, b) =>
          Number(!(a.server?.online ?? true)) -
          Number(!(b.server?.online ?? true)),
      );
    return (
      <View
        whitelist={whitelist}
        hasWhitelist={staff.servers.some(marked)}
        pairs={false}
        rows={shown.map((server) => ({
          address: server.address,
          row: <StaffServerRow server={server} onChanged={staff.reload} />,
        }))}
      />
    );
  }

  if (servers.length === 0) {
    return <Note>No listed server has been online in the last day.</Note>;
  }
  const shown = servers
    .filter((server) => server.whitelist === whitelist)
    .sort((a, b) => Number(!a.online) - Number(!b.online));
  return (
    <View
      whitelist={whitelist}
      hasWhitelist={servers.some((server) => server.whitelist)}
      rows={shown.map((server, index) => ({
        address: `${server.ip}:${server.port}`,
        row: <ServerRow server={server} eager={index < 2} />,
      }))}
    />
  );
}

/**
 * The switch, when there's a whitelist server to switch to (or the Whitelist view is open, so there's a way
 * back), then the rows or a note that the view is empty.
 */
function View({
  whitelist,
  hasWhitelist,
  pairs = true,
  rows,
}: {
  whitelist: boolean;
  hasWhitelist: boolean;
  /** Staff rows need the whole width for their tools. */
  pairs?: boolean;
  rows: { address: string; row: ReactNode }[];
}) {
  return (
    <div className="flex flex-col gap-4 sm:gap-0">
      {(hasWhitelist || whitelist) && (
        <div className="sm:border-border sm:border-t sm:px-4 sm:py-2">
          <ChoiceBar>
            <LinkTabs
              label="Servers"
              className="ml-auto"
              tabs={[
                { href: "/servers", label: "Public", current: !whitelist },
                {
                  href: "/servers?view=whitelist",
                  label: "Whitelist",
                  current: whitelist,
                },
              ]}
            />
          </ChoiceBar>
        </div>
      )}
      {rows.length > 0 ? (
        <Rows rows={rows} pairs={pairs} />
      ) : (
        <Note>
          {whitelist
            ? "No whitelist server has been online in the last day."
            : "No public server has been online in the last day."}
        </Note>
      )}
    </div>
  );
}

/** Keyed by address, so a row the public list already showed stays put when the staff list replaces it. */
function Rows({
  rows,
  pairs,
}: {
  rows: { address: string; row: ReactNode }[];
  pairs: boolean;
}) {
  return (
    <div className="sm:border-border @container sm:border-t">
      {/* From sm up each cell draws the line below it; pulled down a pixel so the last row's line sits on the
          board's edge. A phone keeps the rows apart as separate cards instead. */}
      <ul
        className={classNames(
          "grid gap-2 sm:-mb-px sm:gap-0",
          pairs && "lg:grid-cols-2 @lg:max-sm:grid-cols-2",
        )}
      >
        {rows.map(({ address, row }, index) => (
          <li
            key={address}
            className={classNames(
              "motion-enter sm:border-border sm:border-b",
              pairs && "lg:odd:border-r @lg:max-sm:odd:border-r",
            )}
            style={
              {
                "--motion-delay": `${Math.min(index, 12) * 25}ms`,
              } as CSSProperties
            }
          >
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-text-muted border-border rounded-md border p-5 sm:rounded-none sm:border-x-0 sm:border-t sm:border-b-0 sm:px-4 sm:py-6">
      {children}
    </p>
  );
}
