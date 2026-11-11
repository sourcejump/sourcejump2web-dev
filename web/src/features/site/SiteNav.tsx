"use client";

import { usePathname } from "next/navigation";
import { Link } from "@/ui/Link";
import { isCurrent } from "./navigation";
import styles from "./SiteHeader.module.css";

const navigation = [
  { href: "/activity?show=records", label: "Records" },
  { href: "/leaderboards", label: "Rankings" },
  { href: "/maps", label: "Maps" },
  { href: "/players", label: "Players" },
  { href: "/servers", label: "Servers" },
];

export function SiteNav({ mobile = false }: { mobile?: boolean }) {
  return <SiteNavLinks pathname={usePathname()} mobile={mobile} />;
}
export function SiteNavLinks({
  pathname,
  mobile = false,
}: {
  pathname: string | null;
  mobile?: boolean;
}) {
  return (
    <nav
      aria-label={mobile ? "Mobile" : "Main"}
      className={mobile ? styles.mobileLinks : styles.nav}
    >
      {navigation.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            isCurrent(href.split("?")[0]!, pathname) ? "page" : undefined
          }
        >
          {label}
        </Link>
      ))}
      {mobile && <Link href="/ruleset">Ruleset</Link>}
    </nav>
  );
}
