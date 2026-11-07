// The footer on every page, one quiet line: the ruleset, what the site is, and SourceJump's community by their
// logos in their own colors.
import { ScrollText } from "lucide-react";
import { BrandIcon } from "@/ui/BrandIcon";
import { Link } from "@/ui/Link";
import { communityLinks } from "./navigation";

export function SiteFooter() {
  return (
    <footer className="border-border bg-gutter/50 border-t">
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 px-4 py-5 text-sm">
        <Link
          href="/ruleset"
          className="text-accent hover:text-accent-hover inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        >
          <ScrollText aria-hidden className="size-4" />
          Ruleset
        </Link>
        <p className="text-text-subtle text-xs">
          SourceJump: global records for Counter-Strike: Source bunnyhop.
        </p>
        <nav aria-label="Community">
          <ul className="flex items-center gap-1">
            {communityLinks.map(({ label, brand, href }) => (
              <li key={label}>
                <a
                  href={href}
                  rel="noreferrer"
                  target="_blank"
                  aria-label={label}
                  title={label}
                  className="hover:bg-text/8 flex size-8 items-center justify-center rounded-md transition-colors duration-(--duration-fast)"
                >
                  <BrandIcon brand={brand} colored className="size-4.5" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
