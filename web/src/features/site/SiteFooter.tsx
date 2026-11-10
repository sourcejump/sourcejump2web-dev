// The footer on every page: help, the ruleset, and SourceJump's community elsewhere.
import { Link } from "@/ui/Link";

/** SourceJump's own pages on other sites. The Discord invite is the one the plugin spec links to. */
const communityLinks = [
  { label: "Discord", href: "https://discord.gg/RYP5G4tuwX" },
  { label: "YouTube", href: "https://www.youtube.com/user/SourceJump" },
  {
    label: "Steam group",
    href: "https://steamcommunity.com/groups/SourceJump",
  },
  { label: "TikTok", href: "https://www.tiktok.com/@sourcejump.net" },
];

export function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="text-text-muted mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm">
        <p>SourceJump: global records for Counter-Strike: Source bunnyhop.</p>
        <nav aria-label="Footer">
          {/* Three to a row on a phone, so the six links fill two even rows instead of leaving one alone. */}
          <ul className="grid grid-cols-3 gap-x-6 gap-y-2 sm:flex">
            <li>
              <Link href="/help" className="hover:text-text">
                Help
              </Link>
            </li>
            <li>
              <Link href="/ruleset" className="hover:text-text">
                Ruleset
              </Link>
            </li>
            {communityLinks.map(({ label, href }) => (
              <li key={label}>
                <a
                  href={href}
                  rel="noreferrer"
                  target="_blank"
                  className="hover:text-text"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
