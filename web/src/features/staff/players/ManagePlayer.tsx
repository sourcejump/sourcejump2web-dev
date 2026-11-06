// A player's Manage view, under their header: bans (`manage_bans`), runs and their invalidations
// (`invalidate_runs`), privileges (`manage_privileges`), anti-cheat detections (`review_anticheat`) and the staff
// log about them. Any SteamID works, so
// staff can act on a player before their first run.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { Card, Label } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { EntryList } from "../EntryList";
import { ReadFailure } from "../ReadFailure";
import { InvalidateRuns } from "../runs/InvalidateRuns";
import { InvalidationItem } from "../runs/InvalidationItem";
import { readAsStaff } from "../staffApi";
import { BanItem } from "./BanItem";
import { BanPlayer } from "./BanPlayer";
import { DetectionList } from "./DetectionList";
import { PrivilegeEditor } from "./PrivilegeEditor";
import { getStaffPlayer } from "./staffPlayer";

export async function ManagePlayer({ steamid }: { steamid: string }) {
  const me = await signedInPlayer();
  const mayInvalidate = me?.privileges.includes("invalidate_runs") ?? false;
  const mayReview = me?.privileges.includes("review_anticheat") ?? false;
  const [result, log, invalidations, detections] = await Promise.all([
    getStaffPlayer(steamid),
    readAsStaff((headers) =>
      api.GET("/v1/staff/players/{player}/log", {
        params: { path: { player: steamid } },
        headers,
      }),
    ),
    mayInvalidate
      ? readAsStaff((headers) =>
          api.GET("/v1/staff/invalidations", {
            params: { query: { player: steamid } },
            headers,
          }),
        )
      : undefined,
    mayReview
      ? readAsStaff((headers) =>
          api.GET("/v1/staff/players/{player}/detections", {
            params: { path: { player: steamid } },
            headers,
          }),
        )
      : undefined,
  ]);
  if (!("data" in result)) return <ReadFailure failure={result} />;
  const { player, bans, privileges, valid_runs, invalidated_runs } =
    result.data;
  // SteamID2 and SteamID3 links land on the one SteamID64 address, as on the profile.
  if (player.steamid64 !== steamid) {
    redirect(`/players/${player.steamid64}/manage`);
  }
  const own = me?.steamid64 === player.steamid64;
  const holding =
    invalidations && "data" in invalidations
      ? invalidations.data.invalidations.filter((i) => i.still_invalid > 0)
      : [];

  return (
    <>
      {bans && (
        <Section
          title="Bans"
          hint="Not shown publicly. Reasons are for staff only."
          action={
            !own && (
              <BanPlayer
                player={player}
                validRuns={mayInvalidate ? valid_runs : 0}
              />
            )
          }
        >
          {bans.length === 0 ? (
            <p className="text-text-muted text-sm">Never banned.</p>
          ) : (
            <DividedList>
              {bans.map((ban) => (
                <BanItem key={ban.id} ban={ban} />
              ))}
            </DividedList>
          )}
        </Section>
      )}

      <Section
        title="Runs"
        hint="Invalidated runs are off the boards. Restoring an invalidation brings back the runs it still holds."
        action={
          mayInvalidate && valid_runs > 0 && <InvalidateRuns player={player} />
        }
      >
        <p className="tabular-nums">
          {valid_runs.toLocaleString("en")} valid,{" "}
          {invalidated_runs.toLocaleString("en")} invalidated
        </p>
        {invalidations && !("data" in invalidations) && (
          <ReadFailure failure={invalidations} />
        )}
        {holding.length > 0 && (
          <DividedList>
            {holding.map((entry) => (
              <InvalidationItem
                key={entry.id}
                entry={entry}
                canRestore={mayInvalidate}
              />
            ))}
          </DividedList>
        )}
      </Section>

      {privileges && (
        <Section
          title="Privileges"
          hint="What they may do as staff. Changes apply at once and are logged."
        >
          {/* Keyed by what they hold, so the checklist starts over after a save. */}
          <PrivilegeEditor
            key={privileges.join()}
            player={player}
            held={privileges}
            own={own}
          />
        </Section>
      )}

      {detections && (
        <Section
          title="Anti-cheat"
          hint="What the anti-cheat reported from keyed servers, newest first. Not shown publicly."
        >
          {!("data" in detections) ? (
            <ReadFailure failure={detections} />
          ) : (
            <DetectionList player={player} first={detections.data} />
          )}
        </Section>
      )}

      <Section
        title="Staff log"
        hint="Actions on this player, their runs and their posts, newest first."
      >
        {!("data" in log) ? (
          <ReadFailure failure={log} />
        ) : (
          <EntryList
            key={log.data.entries[0]?.id ?? 0}
            about={{ player: player.steamid64 }}
            first={log.data}
            empty="No staff action has been taken on this player."
          />
        )}
      </Section>
    </>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label>{title}</Label>
          <p className="text-text-muted text-sm">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
