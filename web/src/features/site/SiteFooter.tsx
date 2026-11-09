// The footer on every page, one quiet line in three parts: the ruleset, what the site is, and SourceJump's community
// by their round logos in their own colors. Hairlines part them, as one parts the header's search from the account; on
// phones the parts stack instead.
import { ScrollText } from "lucide-react";
import { BrandIcon } from "@/ui/BrandIcon";
import { Link } from "@/ui/Link";
import { communityLinks } from "./navigation";

export function SiteFooter() {
  return (
    <footer className="border-border bg-gutter/50 border-t">
      <div className="max-w-site mx-auto flex flex-col items-center justify-center gap-3 px-4 py-5 text-sm sm:flex-row sm:gap-5">
        <Link
          href="/ruleset"
          className="text-accent hover:text-accent-hover inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        >
          <ScrollText aria-hidden className="size-4" />
          Ruleset
        </Link>
        <Divider />
        <p className="text-text-subtle text-center text-xs">
          SourceJump: global records for Counter-Strike: Source bunnyhop.
        </p>
        <Divider />
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
                  className="flex size-8 items-center justify-center rounded-full transition duration-(--duration-fast) hover:-translate-y-px"
                >
                  <BrandIcon brand={brand} round className="size-6" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

function Divider() {
  return <span aria-hidden className="bg-border hidden h-4 w-px sm:block" />;
}
