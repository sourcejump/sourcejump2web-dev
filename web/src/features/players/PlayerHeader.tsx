// The top of a player's pages, a masthead across the page: avatar, name, flag, country, first and latest run
// and Steam profile link, their rank in the style shown below, and the Profile / Manage switch for staff.
// Behind it, the map of their latest world record (or latest run), captioned as such. It sits in the player's
// layout, so switching to the Manage view keeps it.
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { api, type Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { getStaffPlayer } from "@/features/staff/players/staffPlayer";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Flag } from "@/ui/Flag";
import { PathTabs } from "@/ui/PathTabs";
import {
  formatDate,
  formatSince,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";
import { Masthead, type MastheadImage } from "@/ui/Masthead";
import { currentStyles } from "@/features/ruleset/styles";
import { getPlayer } from "./playerDetail";
import { ProfileRank } from "./ProfileRank";
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
  const [featured, styles] = await Promise.all([
    profile && featuredRun(profile),
    currentStyles(),
  ]);
  const image = featured && (await mapCover(featured.pb.map));

  const rank =
    profile &&
    ((inline = false) => (
      <ProfileRank
        styles={profile.styles}
        styleOrder={styles.keys}
        styleNames={Object.fromEntries(
          styles.keys.map((key) => [key, styles.name(key)]),
        )}
        draft={profile.points_draft}
        inline={inline}
      />
    ));

  return (
    // Less of the picture above the name on a phone, and a smaller avatar, so the profile starts sooner.
    <Masthead
      image={image}
      // On a phone the avatar overlaps the bottom of the picture band (h-32) by half, and the name starts below it.
      className={image ? "pt-24 pb-6 sm:pt-40 sm:pb-8" : "py-6 sm:py-10"}
    >
      <>
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
            {rank && <div className="sm:hidden">{rank(true)}</div>}
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
                {
                  href: `/players/${player.steamid64}/manage`,
                  label: "Manage",
                },
              ]}
            />
          )}
          {/* Their rank, the main thing a profile tells, for the style the profile below shows: large at the row's
              end; on a phone, the line under the name. */}
          {rank && (
            <div className="ml-auto self-end max-sm:hidden">{rank()}</div>
          )}
        </header>
        {/* What the picture is, on the picture: which run of theirs it's the map of. Outside the header, whose
          entrance transform would make it the box this is placed in. */}
        {image && featured && (
          <div className="absolute inset-x-4 top-3 flex justify-end sm:inset-x-8 sm:top-5">
            {/* The same frosted plate as a server row's labels on its map picture: the picture shows through, softened. */}
            <p className="bg-bg/60 ring-border-strong/60 text-text/80 flex min-w-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs ring-1 backdrop-blur-md">
              <span className="shrink-0">{featured.label}</span>
              <span aria-hidden>·</span>
              <Link
                href={`/maps/${featured.pb.map}?style=${featured.pb.style}${featured.pb.track > 0 ? `&track=${featured.pb.track}` : ""}`}
                className="text-text hover:text-accent truncate font-bold"
              >
                {featured.pb.map}
              </Link>
              <span className="shrink-0 max-sm:hidden">
                {[
                  featured.pb.track > 0 && trackName(featured.pb.track),
                  styles.name(featured.pb.style),
                  formatTime(featured.pb.time),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          </div>
        )}
      </>
    </Masthead>
  );
}

/**
 * The run whose map stands behind the header: their latest world record, or with none, their latest run. Asked of
 * the API rather than picked from the profile, whose personal bests are only each style's first page.
 */
async function featuredRun(
  profile: Schemas["PlayerProfile"],
): Promise<{ pb: Schemas["PersonalBest"]; label: string } | undefined> {
  const records = profile.all_styles.world_records > 0;
  const result = await api
    .GET("/v1/players/{player}/personal-bests", {
      params: {
        path: { player: profile.steamid64 },
        // Without a style: every style, most recently finished first.
        query: { records: records || undefined, limit: 1 },
      },
    })
    .catch(() => undefined);
  const pb = result?.data?.personal_bests[0];
  if (!pb) return undefined;
  return {
    pb,
    label: records ? "Latest world record" : "Latest personal best",
  };
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
