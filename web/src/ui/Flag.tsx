// A country flag from its ISO 3166-1 alpha-2 code, or a question-mark placeholder when there's no country.
import "./flags.css";
import { Tooltip } from "./Tooltip";
import { classNames } from "./classNames";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

// country-flag-icons draws every flag for a 3:2 box, the shape most flags have, so the box is exactly 3:2 and the
// drawing fills it edge to edge: nothing cropped, nothing stretched. A 4:3 set looked too square beside names.
// Whole pixels, so edges stay sharp. No outline: a ring reads differently on light and dark flags, which made some
// look framed and others not.
const sizes = {
  md: "h-3.5 w-[21px] rounded-[2px]",
  lg: "h-5 w-[30px] rounded-[3px]",
};

/**
 * `flags.css` points at one SVG per country, so a browser downloads only the flags it shows.
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
        `flag-${valid.toLowerCase()} inline-block shrink-0 overflow-hidden bg-cover bg-center bg-no-repeat align-middle`,
        sizes[size],
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
