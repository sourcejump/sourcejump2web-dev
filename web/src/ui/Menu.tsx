"use client";
// A button that opens a list of actions or links, e.g. the account menu. Follows the WAI-ARIA menu button pattern.
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type ToggleEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "./Link";
import { anchoredStyle, anchorStyle } from "./anchor";
import { classNames } from "./classNames";

/**
 * Built on the popover attribute, so the browser handles opening, closing on Escape or an outside
 * click, and stacking above everything else. This component adds keyboard movement between items.
 */
export function Menu({
  trigger,
  label,
  align = "start",
  triggerClassName,
  sheet = false,
  children,
}: {
  trigger: ReactNode;
  /** Names the trigger when its content is only an icon or avatar. */
  label?: string;
  align?: "start" | "end";
  triggerClassName?: string;
  /**
   * Opens as a panel across the screen under the site header (h-16), with the page below it dimmed, rather than
   * a dropdown by its trigger: the site's menu on a phone. The dim is part of the menu rather than its backdrop,
   * so the header (and the button that closes it) stays bright; a tap on the dim closes the menu.
   */
  sheet?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Mirrored onto the trigger, so its open look can follow the popover.
  const [open, setOpen] = useState(false);
  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ) ?? [],
    );

  function onToggle(event: ToggleEvent<HTMLDivElement>) {
    setOpen(event.newState === "open");
    if (event.newState === "open") {
      placeWithoutAnchors();
      items()[0]?.focus();
    }
  }

  /**
   * Browsers without CSS anchor positioning (Firefox, Safari before 26) ignore the placement styles and pin the
   * menu to the window's top-left corner, where on a phone it covers the menu button: a second tap then lands
   * on the menu and it can't be closed. There, it's placed under its trigger by hand as it opens.
   */
  function placeWithoutAnchors() {
    const element = menu.current;
    const trigger = button.current;
    if (!element || !trigger || sheet || CSS.supports("position-area: bottom"))
      return;
    const at = trigger.getBoundingClientRect();
    Object.assign(element.style, {
      position: "fixed",
      inset: "auto",
      top: `${at.bottom}px`,
      ...(align === "end"
        ? { right: `${document.documentElement.clientWidth - at.right}px` }
        : { left: `${at.left}px` }),
    });
  }

  // The browser closes the menu on a press outside it, but not on every phone: iOS Safari doesn't count a tap
  // on something that isn't clickable. Any press outside the menu and its trigger closes it here too.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target))
        return;
      if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const next = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: all.length - 1,
    }[event.key];
    if (event.key === "Tab") menu.current?.hidePopover();
    if (next === undefined) return;
    event.preventDefault();
    all[(next + all.length) % all.length]?.focus();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        style={anchorStyle(id)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        popover="auto"
        style={
          sheet
            ? undefined
            : anchoredStyle(
                id,
                align === "end" ? "bottom span-left" : "bottom span-right",
              )
        }
        onToggle={onToggle}
        onKeyDown={onKeyDown}
        // Links navigate without a page load, so the menu closes itself after any choice.
        onClick={(event) => {
          if (
            sheet &&
            !(event.target as HTMLElement).closest("[data-menu-panel]")
          ) {
            menu.current?.hidePopover();
            return;
          }
          if (
            (event.target as HTMLElement).closest(
              '[role="menuitem"], [role="menuitemradio"]',
            )
          )
            menu.current?.hidePopover();
        }}
        // A long list (the Maps page's sorts) scrolls inside the menu rather than running off a short screen.
        className={
          sheet
            ? "bg-bg/60 text-text motion-fade fixed inset-x-0 top-16 bottom-0 m-0 h-auto max-h-none w-full max-w-none overflow-y-auto overscroll-contain"
            : "border-border-strong bg-surface-overlay text-text shadow-popover motion-pop m-0 mt-1 max-h-[min(28rem,70vh)] min-w-44 overflow-y-auto overscroll-contain rounded-md border p-1 text-sm"
        }
      >
        {sheet ? (
          <div
            data-menu-panel
            className="border-border bg-gutter shadow-popover motion-pop border-b"
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </>
  );
}

// The overlay is lighter than surface-raised, so hover lifts with a tint of the text color instead.
const itemClasses =
  "flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-text/8 focus-visible:bg-text/8 [&_svg]:size-4 [&_svg]:text-text-muted aria-checked:[&_svg]:text-accent";

export function MenuItem({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={classNames(itemClasses, className)}
      {...props}
    />
  );
}

export function MenuLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      role="menuitem"
      tabIndex={-1}
      className={classNames(itemClasses, className)}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <div role="separator" className="bg-border-strong -mx-1 my-1 h-px" />;
}
