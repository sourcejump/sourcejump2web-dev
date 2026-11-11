"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./SiteHeader.module.css";

export function HeaderShell({ children }: { children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = header.current!;
    const scroll = () => {
      element.dataset.scrolled = String(scrollY > 16);
    };
    function dismiss(event: PointerEvent) {
      const menu = element.querySelector<HTMLDetailsElement>("details[open]");
      if (menu && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const menu = element.querySelector<HTMLDetailsElement>("details[open]");
      if (menu) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    }
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <header
      ref={header}
      className={styles.header}
      style={{ viewTransitionName: "site-header" }}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          const menu =
            header.current?.querySelector<HTMLDetailsElement>("details[open]");
          if (menu) menu.open = false;
        }
      }}
    >
      {children}
    </header>
  );
}
