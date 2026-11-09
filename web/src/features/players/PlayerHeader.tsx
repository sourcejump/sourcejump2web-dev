// A player's identity, with the profile's style choice and staff view switch.
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import type { Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { getStaffPlayer } from "@/features/staff/players/staffPlayer";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Flag } from "@/ui/Flag";
import { PathTabs } from "@/ui/PathTabs";
import { formatDate, formatSince } from "@/features/runs/time";
import { currentStyles } from "@/features/ruleset/styles";
import { getPlayer } from "./playerDetail";
import { ProfileStyleMenu } from "./ProfileStyleMenu";
import { avatarSrc } from "./avatarSrc";

export async function PlayerHeader({ steamid }: { steamid: string }) {
  const [result, me, styles] = await Promise.all([
    getPlayer(steamid),
    signedInPlayer(),
    currentStyles(),
  ]);
  const manager = managesPlayers(me?.privileges);
  const staffResult = manager ? await getStaffPlayer(steamid) : undefined;
  const staffView =
    staffResult && "data" in staffResult ? staffResult.data : undefined;
  const profile = result?.data;
  const player: Schemas["PlayerRef"] | undefined = profile ?? staffView?.player;
  if (!player) {
    if (result?.response.status === 404 || result?.response.status === 422)
      notFound();
    return null;
  }
  const own = me?.steamid64 === player.steamid64;
  const banned = staffView?.bans?.some((ban) => ban.active) ?? false;
  const country = player.country_code
    ? countryNames.of(player.country_code)
    : undefined;
  const account = BigInt(player.steamid64) - 76561197960265728n;
  const steamId = `STEAM_1:${account % 2n}:${account / 2n}`;

  return (
    <header className="border-border bg-surface flex flex-wrap items-start gap-4 rounded-md border p-5 sm:gap-6 sm:p-6">
      <Avatar
        name={player.name}
        src={avatarSrc(player)}
        size="xl"
        className="max-sm:size-16 max-sm:text-lg"
      />
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold wrap-anywhere sm:text-3xl">
            {player.name}
          </h1>
          {banned && <Badge tone="danger">Banned</Badge>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Flag
            code={player.country_code}
            hint={
              own && !player.country_code
                ? "Pick your country in your profile details, or set it on Steam."
                : undefined
            }
          />
          {country && <span>{country}</span>}
        </div>
        <a
          href={`https://steamcommunity.com/profiles/${player.steamid64}`}
          rel="noreferrer"
          target="_blank"
          className="text-text-muted hover:text-accent inline-flex w-fit items-center gap-1.5 text-xs tabular-nums"
        >
          {steamId}
          <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">Steam profile</span>
        </a>
        <dl className="text-text-subtle flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {profile?.first_run_at && (
            <div className="flex gap-1">
              <dt>First 2.0 run</dt>
              <dd>
                <time dateTime={profile.first_run_at}>
                  {formatDate(profile.first_run_at)}
                </time>
              </dd>
            </div>
          )}
          {profile?.last_run_at && (
            <div className="flex gap-1">
              <dt>Latest run</dt>
              <dd>
                <time
                  dateTime={profile.last_run_at}
                  title={formatDate(profile.last_run_at)}
                >
                  {formatSince(profile.last_run_at)}
                </time>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
        {manager && profile && (
          <PathTabs
            label="View"
            tabs={[
              { href: `/players/${player.steamid64}`, label: "Profile" },
              { href: `/players/${player.steamid64}/manage`, label: "Manage" },
            ]}
          />
        )}
        {profile && (
          <ProfileStyleMenu
            player={profile}
            styleOrder={styles.keys}
            styleNames={Object.fromEntries(
              styles.keys.map((key) => [key, styles.name(key)]),
            )}
          />
        )}
      </div>
    </header>
  );
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Staff permissions are checked again by the API. */
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
