// The top of a player's profile: their setup as they describe it (mouse, DPI, sensitivity and so on), with a
// way to change it for the player themself and for staff who manage bans.
import { api, type Schemas } from "@/api/client";
import type { signedInPlayer } from "@/features/auth/signedInPlayer";
import { detailFields } from "./detailFields";
import { EditDetails } from "./EditDetails";

export async function PlayerDetails({
  player,
  me,
}: {
  player: Schemas["PlayerProfile"];
  me: Awaited<ReturnType<typeof signedInPlayer>>;
}) {
  const own = me?.steamid64 === player.steamid64;
  const staff = !own && (me?.privileges.includes("manage_bans") ?? false);
  const details = player.details;
  const shown = detailFields.filter(({ key }) => details?.[key] != null);
  if (shown.length === 0 && !own && !staff) return null;
  const countries = own || staff ? await countryOptions() : [];

  return (
    <section className="flex flex-col gap-8 max-sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        {shown.length > 0 ? (
          // One row of specs on wider screens, ruled apart like a spec sheet; a three-column grid on a phone.
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-0 sm:gap-y-4">
            {shown.map(({ key, label }) => (
              <div
                key={key}
                className="sm:border-border flex min-w-0 flex-col gap-0.5 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0"
              >
                <dt className="text-text-muted truncate text-xs tracking-wider uppercase sm:tracking-widest">
                  {label}
                </dt>
                <dd className="truncate text-sm tabular-nums sm:text-base">
                  {String(details?.[key])}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-text-muted text-sm">
            {own
              ? "Add your setup, so others can see what you play with."
              : "No details yet."}
          </p>
        )}
        {(own || staff) && (
          <EditDetails
            player={player}
            countries={countries}
            staff={staff}
            hasDetails={shown.length > 0}
          />
        )}
      </div>
      {player.details_from_old_site && (
        <p className="text-text-subtle -mt-6 text-xs">
          From the old site{own ? ", until you save your own" : ""}.
        </p>
      )}
    </section>
  );
}

/**
 * The countries the API accepts, named and sorted here on the server: the browser's own names can differ
 * from Node's, which would make the page's two renders disagree.
 */
async function countryOptions(): Promise<{ code: string; name: string }[]> {
  const result = await api.GET("/v1/countries").catch(() => undefined);
  const names = new Intl.DisplayNames("en", { type: "region" });
  return (result?.data?.codes ?? [])
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
