"use client";
// A map's banner: its cover, cropped to the strip staff chose. Clicking it shows all the map's pictures whole,
// in a Lightbox. The map's title comes in as `title` and its view tabs as `tabs`. On wide screens (lg up) both are
// laid over the picture's lower edge, so the board below starts sooner. Narrower, a long name and the tabs don't fit
// over it, so the title sits under it on the page and only the tabs stay on the picture. Staff controls for the
// Manage view come in as `children`, laid over the picture too.
import { Images } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Schemas } from "@/api/client";
import { Lightbox } from "@/ui/Lightbox";
import { MapImage } from "./MapImage";

export function MapBanner({
  map,
  images,
  title,
  tabs,
  children,
}: {
  map: string;
  /** The page's heading, over the picture's bottom left. Clicks pass through it to the picture, bar its links. */
  title?: ReactNode;
  /** The map's view tabs, beside the title, or on the picture on a phone. */
  tabs?: ReactNode;
  /** In order; the first is the cover. */
  images: Schemas["MapImage"][];
  children?: ReactNode;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const cover = images[0];

  return (
    <div className="relative">
      <div className="relative">
        {cover ? (
          <button
            type="button"
            onClick={() => setShown(0)}
            aria-label={
              images.length > 1
                ? `View the ${images.length} pictures of ${map}`
                : `View the picture of ${map}`
            }
            className="block w-full cursor-zoom-in rounded-md"
          >
            <MapImage image={cover} size="banner" />
          </button>
        ) : (
          <MapImage image={null} size="banner" />
        )}
        {images.length > 1 && (
          <span className="bg-bg/80 text-text pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs tabular-nums">
            <Images aria-hidden className="size-3.5" />
            {images.length}
          </span>
        )}
        {tabs && (
          <div className="absolute right-3 bottom-3 lg:hidden">{tabs}</div>
        )}
      </div>
      {title && (
        // On wide screens, laid straight over the picture, readable by its own shadow rather than a plate or a scrim.
        <div className="lg:text-shadow-over-image pt-3 lg:pointer-events-none lg:absolute lg:inset-0 lg:flex lg:flex-col lg:justify-end lg:p-5 [&_a]:pointer-events-auto">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">{title}</div>
            {tabs && <div className="max-lg:hidden">{tabs}</div>}
          </div>
        </div>
      )}
      {children}
      <Lightbox
        label={`Pictures of ${map}`}
        images={images.map((image) => ({
          url: image.url,
          thumbnailUrl: image.thumbnail_url,
        }))}
        index={shown}
        onIndex={setShown}
      />
    </div>
  );
}
