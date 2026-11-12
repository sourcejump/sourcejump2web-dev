"use client";
// Header navigation: section links on wide screens; on narrow ones, a menu that opens as a panel under the header,
// each section with what's in it, and the ruleset and community at its foot. Marks the current section.
import {
  Activity,
  type LucideIcon,
  Map as MapIcon,
  Menu as MenuIcon,
  ScrollText,
  Server,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "@/ui/Link";
import { BrandIcon } from "@/ui/BrandIcon";
import { classNames } from "@/ui/classNames";
import { Menu } from "@/ui/Menu";
import { communityLinks, isCurrent, sections } from "./navigation";

const icons: Record<(typeof sections)[number]["href"], LucideIcon> = {
  "/leaderboards": Trophy,
  "/maps": MapIcon,
  "/players": Users,
  "/activity": Activity,
  "/servers": Server,
};

import styles from "./SiteHeader.module.css";

// Recovered from the navigation before the desktop header redesign.
export function MobileSiteNav({ pathname }: { pathname: string | null }) {
  return (
    <div className={styles.mobileMenu}>
      <Menu
        label="Sections"
        sheet
        trigger={
          <>
            <MenuIcon
              aria-hidden
              className="size-5 group-aria-expanded:hidden"
            />
            <X
              aria-hidden
              className="hidden size-5 group-aria-expanded:block"
            />
          </>
        }
        triggerClassName="group flex size-10 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text aria-expanded:bg-surface-raised aria-expanded:text-text"
      >
        <ul role="none" className="flex flex-col p-2">
          {sections.map(({ href, label, summary }, index) => {
            const current = isCurrent(href, pathname);
            const Icon = icons[href];
            return (
              <li
                key={href}
                role="none"
                className="motion-enter"
                style={
                  {
                    "--motion-delay": `${index * 25}ms`,
                  } as CSSProperties
                }
              >
                {/* The current section's mark is the desktop underline turned on its side. */}
                <Link
                  href={href}
                  role="menuitem"
                  tabIndex={-1}
                  aria-current={current ? "page" : undefined}
                  // Hover tints the row with the text color, as the other menus do, lighter than the icon's tile,
                  // and lifts the tile a shade: a row in the tile's own color swallowed the tile.
                  className={classNames(
                    "group focus-visible:bg-text/6 relative flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-(--duration-fast) outline-none",
                    current
                      ? "bg-accent-soft before:bg-accent before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full"
                      : "hover:bg-text/6",
                  )}
                >
                  <span
                    className={classNames(
                      "flex size-10 shrink-0 items-center justify-center rounded-md transition-colors duration-(--duration-fast)",
                      current
                        ? "bg-surface-raised text-accent"
                        : "bg-surface-raised text-text-muted group-hover:bg-surface-overlay group-hover:text-text group-focus-visible:bg-surface-overlay group-focus-visible:text-text",
                    )}
                  >
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={classNames(
                        "font-bold",
                        current ? "text-accent" : "text-text",
                      )}
                    >
                      {label}
                    </span>
                    <span className="text-text-muted truncate text-sm">
                      {summary}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div
          role="none"
          className="border-border flex items-center justify-between gap-4 border-t px-5 py-3"
        >
          <Link
            href="/ruleset"
            role="menuitem"
            tabIndex={-1}
            className="text-accent inline-flex items-center gap-1.5 text-sm outline-none focus-visible:underline"
          >
            <ScrollText aria-hidden className="size-4" />
            Ruleset
          </Link>
          <span role="none" className="flex items-center gap-1">
            {communityLinks.map(({ label, brand, href }) => (
              <a
                key={label}
                href={href}
                role="menuitem"
                tabIndex={-1}
                rel="noreferrer"
                target="_blank"
                aria-label={label}
                className="focus-visible:bg-surface-raised flex size-9 items-center justify-center rounded-full outline-none"
              >
                <BrandIcon brand={brand} round className="size-7" />
              </a>
            ))}
          </span>
        </div>
      </Menu>
    </div>
  );
}
