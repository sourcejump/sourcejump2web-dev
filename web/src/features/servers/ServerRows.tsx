"use client";
// The Servers page's list. Everyone gets the listed servers rendered on the server; staff who hold
// manage_servers then get every server from the browser, unlisted ones included, with their tools. A
// Public / Whitelist switch shows whitelist servers apart, filtered here so the page stays cacheable.
import { useSearchParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { StaffServerRow } from "@/features/staff/servers/StaffServerRow";
import { useStaffServers } from "@/features/staff/servers/useStaffServers";
import { Card } from "@/ui/Card";
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
      return (
        <Card className="text-text-muted">
          No server has sent a heartbeat or been listed yet.
        </Card>
      );
    }
    // A server listed before it was ever heard from has no mark to read, so it stays under Public.
    const marked = (server: Schemas["StaffServer"]) =>
      server.server?.whitelist ?? false;
    const shown = staff.servers.filter(
      (server) => marked(server) === whitelist,
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
    return (
      <Card className="text-text-muted">
        No listed server has been online in the last day.
      </Card>
    );
  }
  const shown = servers.filter((server) => server.whitelist === whitelist);
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
    <div className="flex flex-col gap-4">
      {(hasWhitelist || whitelist) && (
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
      )}
      {rows.length > 0 ? (
        <Rows rows={rows} pairs={pairs} />
      ) : (
        <Card className="text-text-muted">
          {whitelist
            ? "No whitelist server has been online in the last day."
            : "No public server has been online in the last day."}
        </Card>
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
    <div className="@container">
      <ul
        className={classNames(
          "grid gap-2",
          pairs && "lg:grid-cols-2 @lg:max-sm:grid-cols-2",
        )}
      >
        {rows.map(({ address, row }, index) => (
          <li
            key={address}
            className="motion-enter"
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
