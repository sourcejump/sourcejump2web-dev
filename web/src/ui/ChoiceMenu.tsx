"use client";
// A compact choice of one option from a list, shown as "Label  Value ▾": a board's style, track or view. Opens a
// Menu of radio items; picking one changes the view in place, or follows the option's link when it has one.
import { Check, ChevronDown } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { classNames } from "./classNames";
import { Menu, MenuItem, MenuLink, MenuSeparator } from "./Menu";

export interface Choice {
  value: string;
  label: string;
  /** Dimmed but still choosable, e.g. a style nobody has run on this track yet. */
  quiet?: boolean;
  /** Dimmed and not choosable here, e.g. pre-2.0 runs on a bonus. Kept in the list so it doesn't vanish. */
  disabled?: boolean;
  /** Where picking it goes, for a choice a server page reads from its address, such as the Maps page's sort. */
  href?: string;
  /** Muted text at the end of its row in the menu, e.g. a count. The trigger shows only the label. */
  detail?: string;
  /** Draws a line above it, to set apart groups in a long list (the Maps page's sorts by name, tier, record). */
  startsGroup?: boolean;
}

export function ChoiceMenu({
  label,
  options,
  value,
  onChange,
}: {
  /** What is being chosen, shown before the current value: "Style". Can differ by width ("Tier" on a phone). */
  label: ReactNode;
  options: Choice[];
  value: string;
  onChange?: (value: string) => void;
}) {
  // Nothing to choose, e.g. styles before any ruleset is published: an empty menu would only open to nothing.
  if (options.length === 0) return null;
  const chosen = options.find((option) => option.value === value);
  return (
    <Menu
      trigger={
        <>
          <span className="text-text-subtle">{label}</span>
          <span>{chosen?.label ?? value}</span>
          <ChevronDown
            aria-hidden
            className="text-text-subtle size-3 shrink-0 transition-transform duration-(--duration-fast) group-aria-expanded:rotate-180 sm:size-4"
          />
        </>
      }
      // As wide as its words at every width, so a page's choices sit side by side on a phone instead of each
      // taking a full row (which stacked three or four tall controls above every board). On a phone it's smaller,
      // chevron included, so four fit on a line.
      // Darker than the surface it sits on, like a well, so it reads as a control without competing with the data.
      triggerClassName="group border-border bg-bg hover:border-border-strong hover:bg-surface-raised aria-expanded:border-border-strong aria-expanded:bg-surface-raised inline-flex h-8 items-center gap-1 rounded-md border pr-1 pl-1.5 text-[11px] font-medium whitespace-nowrap transition-colors duration-(--duration-fast) sm:h-9 sm:gap-2 sm:pr-2.5 sm:pl-3 sm:text-sm"
    >
      {options.map((option) => {
        const className = classNames(
          option.quiet || option.disabled
            ? "text-text-subtle"
            : "text-text-muted hover:text-text aria-checked:text-accent",
          option.disabled && "cursor-not-allowed",
        );
        const content = (
          <>
            <Check
              aria-hidden
              className={option.value === value ? "visible" : "invisible"}
            />
            {option.label}
            {option.detail && (
              <span className="text-text-subtle ml-auto pl-6 text-xs tabular-nums">
                {option.detail}
              </span>
            )}
          </>
        );
        const item =
          option.href && !option.disabled ? (
            <MenuLink
              key={option.value}
              href={option.href}
              role="menuitemradio"
              aria-checked={option.value === value}
              className={className}
            >
              {content}
            </MenuLink>
          ) : (
            <MenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={option.value === value}
              aria-disabled={option.disabled}
              onClick={() => {
                if (!option.disabled) onChange?.(option.value);
              }}
              className={className}
            >
              {content}
            </MenuItem>
          );
        return (
          <Fragment key={option.value}>
            {option.startsGroup && <MenuSeparator />}
            {item}
          </Fragment>
        );
      })}
    </Menu>
  );
}
