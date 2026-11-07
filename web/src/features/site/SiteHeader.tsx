// The top of every page: one bar across the top of the sheet, staying in view while the page scrolls. The
// wordmark and the sections, then the search for players and maps and the account corner. On a phone: the menu,
// the wordmark, the search button and the account corner.
import { Suspense } from "react";
import { Link } from "@/ui/Link";
import { AccountArea } from "./AccountArea";
import { HeaderSearch } from "./HeaderSearch";
import { SiteNav, SiteNavLinks } from "./SiteNav";

export function SiteHeader() {
  return (
    <header
      // Named so page fades leave the header in place (motion.css).
      style={{ viewTransitionName: "site-header" }}
      className="bg-gutter border-border sticky top-0 z-10 border-b"
    >
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6 lg:gap-8">
        <Link
          href="/"
          className="text-lg font-bold tracking-wider whitespace-nowrap uppercase"
        >
          Source<span className="text-accent">Jump</span>
        </Link>
        <Suspense fallback={<SiteNavLinks pathname={null} />}>
          <SiteNav />
        </Suspense>
        <div className="ml-auto flex items-center gap-1">
          {/* Uses the address to close its list on a page change, so it streams in like the section links. */}
          <Suspense
            fallback={<div className="size-9 xl:h-9 xl:w-64 2xl:w-72" />}
          >
            <HeaderSearch />
          </Suspense>
          <span
            aria-hidden
            className="bg-border mx-3 hidden h-6 w-px xl:mx-4 xl:block"
          />
          {/* Depends on the session cookie, so it streams in per request while the shell stays static. */}
          <Suspense>
            <AccountArea />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
