// A page's full-width top band, edge to edge under the site header: on its own surface, or over a picture
// (a map's), its text shadowed to read over it; on a phone, the picture is a band above the text. Its content lines up with the page's own width below it.
import type { ReactNode } from "react";
import { classNames } from "./classNames";

export interface MastheadImage {
  /** The full-size picture (1920 wide). */
  url: string;
  /** The small one (480 wide), for screens it covers sharply. */
  thumbnailUrl: string;
  /** Which horizontal strip shows: 0 the top, 100 the bottom. */
  focus: number;
}

export function Masthead({
  image,
  className,
  children,
}: {
  image?: MastheadImage;
  /** For the content row: its padding and layout. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={classNames(
        "border-border relative isolate overflow-hidden border-b",
        image ? "bg-bg" : "bg-surface",
      )}
    >
      {image && (
        <>
          {/* It's the top of the page, so it loads at once rather than lazily. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- the API stores each size; nothing to resize */}
          <img
            src={image.url}
            srcSet={`${image.thumbnailUrl} 480w, ${image.url} 1920w`}
            sizes="100vw"
            alt=""
            fetchPriority="high"
            className="motion-settle absolute inset-x-0 top-0 -z-10 h-28 w-full object-cover sm:h-full"
            style={{ objectPosition: `center ${image.focus}%` }}
          />
          {/* From sm up, a light fade into the page at the bottom, where the text sits, and the text's own shadow does
              the rest, so the picture stays clearly visible. On a phone the picture is only a band at the top that
              fades fully into the page, and the text sits below it on the page, where it's always readable. */}
          <div className="from-bg sm:from-bg/70 absolute inset-x-0 top-0 -z-10 h-28 bg-linear-to-t to-transparent to-50% sm:h-full sm:to-60%" />
        </>
      )}
      <div
        className={classNames(
          "mx-auto w-full max-w-6xl px-4 sm:px-8",
          image && "sm:text-shadow-over-image",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
