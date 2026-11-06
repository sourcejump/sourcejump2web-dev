"use client";
// A row of options where one is chosen, e.g. a leaderboard's style. Looks like segmented Tabs; changes state in place.
import { classNames } from "./classNames";
import { tabStyles } from "./tabStyles";

export interface SegmentedOption {
  value: string;
  label: string;
}

/** Each option is a toggle button; the chosen one is pressed. */
export function Segmented({
  options,
  value,
  onChange,
  label,
  fillOnPhones = false,
  className,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Names the group for screen readers. */
  label: string;
  /** On a phone, spans its container with the options sharing the width. */
  fillOnPhones?: boolean;
  className?: string;
}) {
  const styles = tabStyles.segmented;
  return (
    <div
      role="group"
      aria-label={label}
      className={classNames(
        styles.list,
        "max-w-full [scrollbar-width:none] overflow-x-auto",
        fillOnPhones && "max-sm:flex max-sm:w-full",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={classNames(
            "shrink-0 whitespace-nowrap transition-colors duration-(--duration-fast)",
            fillOnPhones && "max-sm:flex-1",
            styles.tab,
            option.value === value ? styles.active : styles.idle,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
