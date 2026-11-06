// A country flag from its ISO 3166-1 alpha-2 code, or a question-mark placeholder when there's no country.
import "flag-icons/css/flag-icons.min.css";
import { Tooltip } from "./Tooltip";
import { classNames } from "./classNames";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

// The 4:3 drawings lose a pixel top and bottom, so stripes stay on whole pixels.
const sizes = {
  md: "h-4 w-6 rounded-[2px]",
  lg: "h-5.5 w-8 rounded-[3px]",
};

const outline =
  "shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-text)_10%,transparent)]";

/**
 * flag-icons' stylesheet points at one SVG per country, so a browser downloads only the flags it shows.
 * `hint` replaces the tooltip, e.g. to tell a player how to set their country.
 */
export function Flag({
  code,
  hint,
  size = "md",
  className,
}: {
  code: string | null | undefined;
  hint?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const valid = code && /^[A-Z]{2}$/.test(code) ? code : null;
  const label = valid
    ? (countryNames.of(valid) ?? valid)
    : "No country set on Steam";
  const flag = valid ? (
    <span
      role="img"
      aria-label={label}
      title={hint ? undefined : label}
      tabIndex={hint ? 0 : undefined}
      className={classNames(
        `fi-${valid.toLowerCase()} inline-block shrink-0 bg-cover bg-center align-middle`,
        sizes[size],
        outline,
        className,
      )}
    />
  ) : (
    // A flag-sized box with a question mark, so a missing country reads as unknown rather than as a flag.
    <span
      role="img"
      aria-label={label}
      title={hint ? undefined : label}
      tabIndex={hint ? 0 : undefined}
      className={classNames(
        "bg-surface-raised text-text-subtle inline-flex shrink-0 items-center justify-center align-middle",
        sizes[size],
        outline,
        className,
      )}
    >
      <span aria-hidden className="text-[10px] leading-none font-bold">
        ?
      </span>
    </span>
  );
  return hint ? <Tooltip content={hint}>{flag}</Tooltip> : flag;
}
