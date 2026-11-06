// The footer on every page: the ruleset, and SourceJump's community elsewhere.
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
        <p>SourceJump: global records for Counter-Strike: Source bunnyhop. (preview test)</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-6">
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
