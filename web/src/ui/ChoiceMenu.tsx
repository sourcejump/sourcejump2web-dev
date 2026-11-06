"use client";
// A compact choice of one option from a list, shown as "Label  Value ▾": a board's style, track or view. Opens a
// Menu of radio items; picking one changes the view in place, or follows the option's link when it has one.
import { Check, ChevronDown } from "lucide-react";
import { Fragment } from "react";
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
  /** What is being chosen, shown before the current value: "Style". */
  label: string;
  options: Choice[];
  value: string;
  onChange?: (value: string) => void;
}) {
  // Nothing to choose, e.g. styles before any ruleset is published: an empty menu would only open to nothing.
  if (options.length === 0) return null;
  const chosen = options.find((option) => option.value === value);
  return (
    <Menu
      matchTriggerWidth
      trigger={
        <>
          <span className="text-text-subtle">{label}</span>
          <span className="ml-auto sm:ml-0">{chosen?.label ?? value}</span>
          <ChevronDown
            aria-hidden
            className="text-text-subtle group-hover:text-text-muted group-aria-expanded:text-text-muted size-4 transition-colors duration-(--duration-fast)"
          />
        </>
      }
      // On a phone each menu takes a full row, label on the left and value on the right, so menus of different
      // widths line up as one column instead of wrapping unevenly.
      triggerClassName="group bg-text/4 hover:bg-text/8 aria-expanded:bg-text/8 flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors duration-(--duration-fast) sm:inline-flex sm:w-auto"
    >
      {options.map((option) => {
        const className = classNames(
          (option.quiet || option.disabled) && "text-text-subtle",
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
