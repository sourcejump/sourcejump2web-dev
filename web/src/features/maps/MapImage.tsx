// A map's picture, or a placeholder until staff add one: a tile beside a run's title, the top of a map's card in
// the Maps grid, a banner on the map's page.
// The stored image is 16:9; the banner shows the strip of it staff chose (`focus`, 0 the top to 100 the bottom).
import { ImageOff } from "lucide-react";
import type { Schemas } from "@/api/client";
import { classNames } from "@/ui/classNames";

const sizes = {
  /** Beside a player's latest run in the Players list: as tall as the badge line and the small line under it. */
  thumb: "h-10.5 w-19 rounded-sm",
  tile: "h-14 w-24 rounded-md sm:h-20 sm:w-36",
  banner: "h-36 w-full rounded-lg sm:h-48",
  /** The top of a map's tile in the Maps grid, at the picture's own 16:9. */
  card: "aspect-video w-full",
};

export function MapImage({
  image,
  size,
  className,
}: {
  image: Schemas["MapImage"] | null | undefined;
  size: keyof typeof sizes;
  className?: string;
}) {
  const classes = classNames(
    "border-border bg-surface-raised shrink-0 overflow-hidden border object-cover",
    sizes[size],
    className,
  );
  if (image) {
    // The API stores each image at the sizes it's shown at, so there's nothing for Next's resizer to do.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={size === "banner" ? image.url : image.thumbnail_url}
        alt=""
        loading="lazy"
        className={classes}
        style={
          size === "banner"
            ? { objectPosition: `center ${image.focus}%` }
            : undefined
        }
      />
    );
  }
  return (
    <span
      aria-hidden
      className={classNames(
        classes,
        "text-text-subtle flex items-center justify-center",
      )}
    >
      <ImageOff className={size === "thumb" ? "size-4" : "size-8"} />
    </span>
  );
}
