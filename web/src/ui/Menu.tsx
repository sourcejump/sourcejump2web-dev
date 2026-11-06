"use client";
// A button that opens a list of actions or links, e.g. the account menu. Follows the WAI-ARIA menu button pattern.
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type ToggleEvent,
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
  matchTriggerWidth = false,
  children,
}: {
  trigger: ReactNode;
  /** Names the trigger when its content is only an icon or avatar. */
  label?: string;
  align?: "start" | "end";
  triggerClassName?: string;
  /** On a phone, opens at least as wide as the trigger, for a trigger that spans the screen (ChoiceMenu). */
  matchTriggerWidth?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
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
    if (event.newState === "open") items()[0]?.focus();
  }

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
        style={anchoredStyle(
          id,
          align === "end" ? "bottom span-left" : "bottom span-right",
        )}
        onToggle={onToggle}
        onKeyDown={onKeyDown}
        // Links navigate without a page load, so the menu closes itself after any choice.
        onClick={(event) => {
          if (
            (event.target as HTMLElement).closest(
              '[role="menuitem"], [role="menuitemradio"]',
            )
          )
            menu.current?.hidePopover();
        }}
        // A long list (the Maps page's sorts) scrolls inside the menu rather than running off a short screen.
        className={classNames(
          "border-border-strong bg-surface-overlay text-text shadow-popover motion-pop m-0 mt-1 max-h-[min(28rem,70vh)] min-w-44 overflow-y-auto overscroll-contain rounded-lg border p-1 text-sm",
          matchTriggerWidth && "max-sm:min-w-[anchor-size(width)]",
        )}
      >
        {children}
      </div>
    </>
  );
}

// The overlay is lighter than surface-raised, so hover lifts with a tint of the text color instead.
const itemClasses =
  "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-text/8 focus-visible:bg-text/8 [&_svg]:size-4 [&_svg]:text-text-muted aria-checked:[&_svg]:text-accent";

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
