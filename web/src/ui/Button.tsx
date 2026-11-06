// Buttons and button-styled links. One primary action per view; everything else is secondary or ghost.
import { Link } from "./Link";
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

type Variant = "primary" | "secondary" | "soft" | "ghost";
type Size = "xs" | "sm" | "md";

interface Style {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary:
    "border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-raised",
  // For an action repeated down a list, such as a server's Join.
  soft: "border border-accent/30 bg-accent-soft text-accent hover:border-accent/60 hover:bg-accent/20",
  // A ghost button that toggles something (a viewer's freecam, a settings popover) shows the accent while on.
  ghost:
    "text-text-muted hover:bg-surface-raised hover:text-text aria-expanded:text-accent aria-pressed:bg-accent-soft aria-pressed:text-accent",
};

const sizes: Record<Size, string> = {
  xs: "h-6 gap-1 px-2.5 text-xs",
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
};

/** For anchors outside the site, like `steam://` links, that `ButtonLink` (a page link) can't be. */
export function buttonClasses({ variant = "secondary", size = "md" }: Style) {
  return classNames(
    "inline-flex shrink-0 items-center justify-center rounded-md font-bold whitespace-nowrap",
    "transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4",
    variants[variant],
    sizes[size],
  );
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: Style & ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={classNames(buttonClasses({ variant, size }), className)}
      {...props}
    />
  );
}

/**
 * A button-styled link that leaves the app for a full page load, such as sign-in, which goes through Steam.
 * For links within the site, use ButtonLink.
 */
export function ButtonAnchor({
  variant,
  size,
  className,
  ...props
}: Style & ComponentProps<"a">) {
  return (
    <a
      className={classNames(buttonClasses({ variant, size }), className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: Style & ComponentProps<typeof Link>) {
  return (
    <Link
      className={classNames(buttonClasses({ variant, size }), className)}
      {...props}
    />
  );
}
