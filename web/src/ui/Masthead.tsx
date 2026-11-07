// A page's full-width top band, edge to edge under the site header: on its own surface, or over a picture
// (a map's) darkened enough to read over. Its content lines up with the page's own width below it.
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
            className="motion-settle absolute inset-0 -z-10 size-full object-cover"
            style={{ objectPosition: `center ${image.focus}%` }}
          />
          {/* Scrims, as on the home header: the page's own color rising from the bottom, where the text sits,
              and from the left, where it starts. Map pictures are often bright sky. */}
          <div className="from-bg via-bg/70 to-bg/30 absolute inset-0 -z-10 bg-linear-to-t" />
          <div className="from-bg/80 absolute inset-0 -z-10 bg-linear-to-r to-transparent to-70%" />
        </>
      )}
      <div
        className={classNames(
          "mx-auto w-full max-w-6xl px-4 sm:px-8",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
