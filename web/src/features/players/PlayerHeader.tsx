// The top of a player's pages, a masthead across the page: avatar, name, flag, country, first and latest run
// and Steam profile link, with the Profile / Manage switch for staff. Behind it, a picture of the map of one of
// their best runs, named in the corner. It sits in the player's layout, so switching to the Manage view keeps it.
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { api, type Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { getStaffPlayer } from "@/features/staff/players/staffPlayer";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Flag } from "@/ui/Flag";
import { PathTabs } from "@/ui/PathTabs";
import { formatDate, formatSince, formatTime } from "@/features/runs/time";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";
import { Masthead, type MastheadImage } from "@/ui/Masthead";
import { Medal } from "@/ui/Medal";
import { currentStyles } from "@/features/ruleset/styles";
import { getPlayer } from "./playerDetail";
import { avatarSrc } from "@/features/players/avatarSrc";

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

  // Country, first and latest run come with the public profile; a player only staff can see has none of them.
  const country = player.country_code
    ? countryNames.of(player.country_code)
    : undefined;
  const firstRun = profile?.first_run_at;
  const lastRun = profile?.last_run_at;
  const featured = profile && featuredRun(profile);
  const [image, styles] = featured
    ? await Promise.all([mapCover(featured.map), currentStyles()])
    : [];

  return (
    // Less of the picture above the name on a phone, and a smaller avatar, so the profile starts sooner.
    <Masthead
      image={image}
      // On a phone the avatar overlaps the bottom of the picture band (h-28) and the name starts below it.
      className={image ? "pt-20 pb-6 sm:pt-40 sm:pb-8" : "py-6 sm:py-10"}
    >
      <header className="motion-enter flex flex-wrap items-center gap-x-4 gap-y-3 sm:gap-x-6 sm:gap-y-4">
        <Avatar
          name={player.name}
          src={avatarSrc(player)}
          size="xl"
          className={classNames(
            "max-sm:size-16 max-sm:text-lg",
            image && "max-sm:border-bg max-sm:border-4",
          )}
        />
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2 max-sm:basis-full">
          {/* One line of text, so the flag sits at the middle of the name's letters (`vertical-align: middle`)
              rather than the middle of its line box, which reads as high beside a lowercase name. */}
          <div className="min-w-0 text-2xl font-bold break-words sm:text-4xl">
            <h1 className="inline">{player.name}</h1>
            <Flag
              code={player.country_code}
              size="lg"
              className="ml-3"
              hint={
                isOwn && !player.country_code
                  ? "Your Steam profile has no country. Pick one in your details below, or set one on Steam and it shows here after your next sign-in."
                  : undefined
              }
            />
            {banned && (
              <span className="ml-3 inline-block align-middle">
                <Badge tone="danger">Banned</Badge>
              </span>
            )}
          </div>
          {/* Facts about the player, then the way out to Steam. The run dates count 2.0 runs alone. */}
          <div className="text-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:gap-x-6">
            <dl className="contents">
              {country && (
                <div>
                  <dt className="sr-only">Country</dt>
                  <dd>{country}</dd>
                </div>
              )}
              {firstRun && (
                <div className="flex gap-1.5">
                  <dt>First 2.0 run</dt>
                  <dd className="text-text">
                    <time dateTime={firstRun}>{formatDate(firstRun)}</time>
                  </dd>
                </div>
              )}
              {lastRun && (
                <div className="flex gap-1.5">
                  <dt>Latest run</dt>
                  <dd className="text-text">
                    <time dateTime={lastRun} title={formatDate(lastRun)}>
                      {formatSince(lastRun)}
                    </time>
                  </dd>
                </div>
              )}
            </dl>
            <a
              href={`https://steamcommunity.com/profiles/${player.steamid64}`}
              rel="noreferrer"
              target="_blank"
              className="hover:text-text inline-flex items-center gap-1"
            >
              Steam profile
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </div>
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
        {/* What the picture is: the map, and the run on it. */}
        {image && featured && (
          <p className="text-text-muted flex basis-full items-center gap-2 text-sm sm:ml-auto sm:basis-auto sm:self-end">
            <Medal placement={featured.rank} />
            <Link
              href={`/maps/${featured.map}?style=${featured.style}`}
              className="text-text hover:text-accent"
            >
              {featured.map}
            </Link>
            {/* It may be any style's run, so the style is named. */}
            <span>{styles?.name(featured.style)}</span>
            <span className="tabular-nums">{formatTime(featured.time)}</span>
          </p>
        )}
      </header>
    </Masthead>
  );
}

/**
 * The run whose map stands behind the header: the best placed of the personal bests that came with the profile
 * (each style's first page of main tracks, by map), the latest of equals. Not necessarily their best overall.
 */
function featuredRun(
  profile: Schemas["PlayerProfile"],
): (Schemas["PersonalBest"] & { rank: number }) | undefined {
  let best: (Schemas["PersonalBest"] & { rank: number }) | undefined;
  for (const pb of profile.styles.flatMap((style) => style.personal_bests)) {
    if (pb.rank == null || pb.legacy) continue;
    if (
      !best ||
      pb.rank < best.rank ||
      (pb.rank === best.rank &&
        (pb.finished_at ?? "") > (best.finished_at ?? ""))
    ) {
      best = { ...pb, rank: pb.rank };
    }
  }
  return best;
}

/** A map's cover picture; none when it has no pictures or can't be loaded, and the header goes without. */
async function mapCover(map: string): Promise<MastheadImage | undefined> {
  const result = await api
    .GET("/v1/maps/{map}", { params: { path: { map } } })
    .catch(() => undefined);
  const cover = result?.data?.images[0];
  return cover
    ? { url: cover.url, thumbnailUrl: cover.thumbnail_url, focus: cover.focus }
    : undefined;
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

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
