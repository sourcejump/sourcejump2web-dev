// The site's main sections, shown in the header (the phone menu adds each one's summary). Each section's page arrives with its roadmap slice. Community
// posts (`/community`) are left out of the header for now (lead, 2026-10-28); the pages and API remain.
export const sections = [
  {
    href: "/leaderboards",
    label: "Leaderboards",
    summary: "Top players by points and by completed maps",
  },
  {
    href: "/maps",
    label: "Maps",
    summary: "Every map, with its tier and world record",
  },
  {
    href: "/players",
    label: "Players",
    summary: "Find a player, or see who played last",
  },
  {
    href: "/activity",
    label: "Activity",
    summary: "Runs and records as they're finished",
  },
  {
    href: "/servers",
    label: "Servers",
    summary: "SourceJump servers and who's on them",
  },
] as const;

/** A section is current on its own page and on every page below it. */
export function isCurrent(href: string, pathname: string | null): boolean {
  if (pathname === null) return false;
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** SourceJump's own pages on other sites. The Discord invite is the one the plugin spec links to. */
export const communityLinks = [
  { label: "Discord", brand: "discord", href: "https://discord.gg/RYP5G4tuwX" },
  {
    label: "YouTube",
    brand: "youtube",
    href: "https://www.youtube.com/user/SourceJump",
  },
  {
    label: "Steam",
    brand: "steam",
    href: "https://steamcommunity.com/groups/SourceJump",
  },
  {
    label: "TikTok",
    brand: "tiktok",
    href: "https://www.tiktok.com/@sourcejump.net",
  },
  {
    label: "Instagram",
    brand: "instagram",
    href: "https://www.instagram.com/sourcejump_official",
  },
] as const;
