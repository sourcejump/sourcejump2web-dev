"use client";
// Header navigation: section links on wide screens, a menu on narrow ones. Marks the current section.
import { Menu as MenuIcon } from "lucide-react";
import { Link } from "@/ui/Link";
import { usePathname } from "next/navigation";
import { classNames } from "@/ui/classNames";
import { Menu, MenuLink } from "@/ui/Menu";
import { isCurrent, sections } from "./navigation";

/**
 * On pages with a dynamic address, such as a profile, the path is only known per request. SiteHeader shows
 * `SiteNavLinks` without a current section while it streams in, so every page's shell stays static.
 */
export function SiteNav() {
  return <SiteNavLinks pathname={usePathname()} />;
}

export function SiteNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <>
      <nav aria-label="Main" className="hidden h-full lg:block">
        <ul className="flex h-full items-stretch">
          {sections.map(({ href, label }) => {
            const current = isCurrent(href, pathname);
            return (
              <li key={href} className="flex">
                {/* A bar along the header's bottom edge marks the current section; on hover one grows in under
                    the others. */}
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={classNames(
                    "relative flex items-center px-3.5 text-base transition-colors duration-(--duration-fast)",
                    "after:absolute after:inset-x-3.5 after:-bottom-px after:h-0.5 after:rounded-full after:transition-transform after:duration-(--duration-base) after:ease-out",
                    current
                      ? "text-accent after:bg-accent"
                      : "text-text-muted hover:text-text after:bg-border-strong after:scale-x-0 hover:after:scale-x-100",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Ordered before the wordmark, so on a phone the menu button sits on its left. */}
      <div className="-order-1 -ml-2 lg:hidden">
        <Menu
          label="Sections"
          trigger={<MenuIcon aria-hidden className="size-5" />}
          triggerClassName="flex size-10 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
        >
          {sections.map(({ href, label }) => (
            <MenuLink
              key={href}
              href={href}
              aria-current={isCurrent(href, pathname) ? "page" : undefined}
              className="aria-[current=page]:text-accent"
            >
              {label}
            </MenuLink>
          ))}
        </Menu>
      </div>
    </>
  );
}
