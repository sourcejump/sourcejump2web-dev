// Sign in through Steam: the Steam logo and the label on the header's dark band. Hover is a quiet step up, a
// lighter surface and a firmer edge, as everything else on the bar; a press settles it a pixel.
import type { ComponentProps } from "react";
import { BrandIcon } from "./BrandIcon";
import { classNames } from "./classNames";

/** A full page load (the API redirects to Steam), so a plain anchor rather than a Link. */
export function SteamButton({
  className,
  children,
  ...props
}: ComponentProps<"a">) {
  return (
    <a
      className={classNames(
        "bg-gutter border-border-strong text-text hover:bg-surface-raised hover:border-text-subtle inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-bold whitespace-nowrap transition-[background-color,border-color,translate] duration-(--duration-fast) active:translate-y-px",
        className,
      )}
      {...props}
    >
      <BrandIcon brand="steam" className="size-4.5" />
      <span>{children}</span>
    </a>
  );
}
