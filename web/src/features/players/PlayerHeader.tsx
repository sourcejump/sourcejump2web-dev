// The top of a player's pages: avatar, name, flag and Steam profile link, with the Profile / Manage switch for
// staff. It sits in the player's layout, so switching to the Manage view keeps it in place.
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import type { Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { getStaffPlayer } from "@/features/staff/players/staffPlayer";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Flag } from "@/ui/Flag";
import { PathTabs } from "@/ui/PathTabs";
import { getPlayer } from "./playerDetail";

export async function PlayerHeader({ steamid }: { steamid: string }) {
  const [result, me] = await Promise.all([
    getPlayer(steamid),
    signedInPlayer(),
  ]);
  const manager = managesPlayers(me?.privileges);
  const staffResult = manager ? await getStaffPlayer(steamid) : undefined;
  const staffView =
    staffResult && "data" in staffResult ? staffResult.data : undefined;
  const profile = result?.data;
  const player: Schemas["PlayerRef"] | undefined = profile ?? staffView?.player;
  if (!player) {
    if (result?.response.status === 404 || result?.response.status === 422) {
      notFound();
    }
    return null;
  }
  const isOwn = me?.steamid64 === player.steamid64;
  const banned = staffView?.bans?.some((ban) => ban.active) ?? false;

  return (
    <header className="motion-enter flex flex-wrap items-center gap-5">
      <Avatar
        name={player.name}
        src={player.avatar_url ?? undefined}
        size="xl"
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{player.name}</h1>
          <Flag
            code={player.country_code}
            size="lg"
            hint={
              isOwn && !player.country_code
                ? "Your Steam profile has no country. Pick one in your details below, or set one on Steam and it shows here after your next sign-in."
                : undefined
            }
          />
          {banned && <Badge tone="danger">Banned</Badge>}
        </div>
        <a
          href={`https://steamcommunity.com/profiles/${player.steamid64}`}
          rel="noreferrer"
          target="_blank"
          className="text-text-muted hover:text-text inline-flex items-center gap-1 self-start text-sm"
        >
          Steam profile
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
      {/* A player SourceJump hasn't seen has no profile to switch to. */}
      {manager && profile && (
        <PathTabs
          label="View"
          className="ml-auto self-start"
          tabs={[
            { href: `/players/${player.steamid64}`, label: "Profile" },
            { href: `/players/${player.steamid64}/manage`, label: "Manage" },
          ]}
        />
      )}
    </header>
  );
}

/** Who sees the Manage view: staff who can act on players. The API checks each privilege again. */
export function managesPlayers(
  privileges: readonly Schemas["Privilege"][] | undefined,
): boolean {
  return (
    privileges?.some(
      (p) =>
        p === "manage_bans" ||
        p === "invalidate_runs" ||
        p === "manage_privileges",
    ) ?? false
  );
}
