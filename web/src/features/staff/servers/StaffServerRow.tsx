"use client";
// A server row as staff see it: the public row plus Unlisted and Not compliant badges, its details, the
// whitelist toggle on listed rows and the listing toggle. A server listed before it was ever heard from gets a plain row with its address.
import type { Schemas } from "@/api/client";
import { ServerRow, ServerRowFrame } from "@/features/servers/ServerRow";
import { Badge } from "@/ui/Badge";
import { ListingToggle } from "./ListingToggle";
import { ServerDetails } from "./ServerDetails";
import { WhitelistToggle } from "./WhitelistToggle";

export function StaffServerRow({
  server,
  onChanged,
}: {
  server: Schemas["StaffServer"];
  onChanged: () => void;
}) {
  const listed = !!server.listing;
  const toggle = (
    <ListingToggle
      address={server.address}
      listed={listed}
      onChanged={onChanged}
    />
  );

  if (!server.server || !server.report) {
    return (
      <ServerRowFrame className="flex h-full flex-wrap items-center gap-4 p-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-bold tabular-nums">{server.address}</span>
          <span className="text-text-muted text-sm">
            Listed, but not heard from yet. It shows once it sends a heartbeat.
          </span>
        </span>
        {toggle}
      </ServerRowFrame>
    );
  }

  return (
    <ServerRow
      server={server.server}
      unlisted={!listed}
      badges={
        <>
          {!listed && <Badge>Unlisted</Badge>}
          {!server.report.compliant && (
            <Badge tone="warning">Not compliant</Badge>
          )}
        </>
      }
      tools={
        <>
          <ServerDetails
            server={server.server}
            report={server.report}
            listing={server.listing}
          />
          {listed && (
            <WhitelistToggle
              address={server.address}
              whitelist={server.server.whitelist}
              onChanged={onChanged}
            />
          )}
          {toggle}
        </>
      }
    />
  );
}
