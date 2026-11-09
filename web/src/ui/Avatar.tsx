"use client";
// A player's picture, or their initials when there is none or it doesn't load (the API's avatar route before an
// API that has it is deployed, or Steam's CDN failing).
import { useCallback, useState } from "react";
import { classNames } from "./classNames";

type Size = "sm" | "md" | "lg" | "xl";

const sizes: Record<Size, string> = {
  sm: "size-6 text-xs",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
  xl: "size-24 text-2xl",
};

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string;
  size?: Size;
  className?: string;
}) {
  const classes = classNames(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-raised font-bold text-text-muted",
    sizes[size],
    className,
  );
  // The picture this element failed to load, so a new `src` gets its own try.
  const [failed, setFailed] = useState<string>();
  // A cached failure can arrive before hydration attaches the error handler.
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete && image.naturalWidth === 0) setFailed(src);
    },
    [src],
  );
  if (src && src !== failed) {
    // Steam serves avatars pre-sized from its CDN, so next/image's resizing would add nothing.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imageRef}
        src={src}
        alt=""
        className={classes}
        onError={() => setFailed(src)}
      />
    );
  }
  return (
    <span aria-hidden className={classes}>
      {initials(name)}
    </span>
  );
}

/** First letter of the first two words: "strafe cat" is "SC", "nova" is "N". */
function initials(name: string): string {
  const words = name.split(/[\s_.-]+/);
  const letters = words.map((word) => word.match(/\p{L}|\p{N}/u)?.[0]);
  return letters.filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}
