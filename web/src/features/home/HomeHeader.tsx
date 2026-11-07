// The home page's header: the site's picture with its name over it, and the way in.
import Image from "next/image";
import type { CSSProperties } from "react";
import { ButtonLink } from "@/ui/Button";
import { HeaderDepth } from "./HeaderDepth";
import header from "./header.png";
import headerDepth from "./header-depth.webp";

// Wider than a phone, the picture is shown at its own size, centered and cropped: shrinking it to fit averages
// away its fine grain, which is what makes it look sharp. Centered by position rather than a transform, which
// the browser snaps to whole pixels; a half-pixel offset would blur the picture again.
const nativeSize =
  "sm:absolute sm:top-(--top) sm:left-(--left) sm:h-(--height) sm:w-(--width) sm:max-w-none";
const nativePlacement = {
  "--width": `${header.width}px`,
  "--height": `${header.height}px`,
  "--left": `calc(50% - ${header.width / 2}px)`,
  "--top": `calc(50% - ${header.height / 2}px)`,
} as CSSProperties;

/** A static import, so Next.js knows the size, serves modern formats at the screen's width, and blurs in. */
export function HomeHeader() {
  return (
    <header className="border-border relative flex h-80 overflow-hidden rounded-md border sm:h-72">
      {/* On a phone the text takes the lower half, so the picture fills only the top two thirds and fades out
          there: the jumper then sits between the top edge and the text instead of behind it. The settle zoom is
          on this box so the depth canvas moves with the picture. */}
      <div className="motion-settle absolute inset-x-0 top-0 h-2/3 sm:inset-0 sm:h-auto">
        <Image
          src={header}
          alt=""
          priority
          quality={90}
          placeholder="blur"
          sizes={`(min-width: 40rem) ${header.width}px, 100vw`}
          style={nativePlacement}
          className={`size-full object-cover ${nativeSize}`}
        />
        <HeaderDepth
          depth={headerDepth.src}
          style={nativePlacement}
          className={`pointer-events-none hidden ${nativeSize} sm:block`}
        />
        <div className="from-bg absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t to-transparent sm:hidden" />
      </div>
      {/* Fades the picture into the page at the bottom and darkens its left side, so the text stays readable on
          any part of it. */}
      <div className="from-bg absolute inset-0 bg-linear-to-t via-transparent to-transparent" />
      <div className="from-bg/80 absolute inset-0 bg-linear-to-r to-transparent to-60%" />
      <div className="relative mt-auto flex flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <h1 className="motion-enter text-4xl font-bold">SourceJump</h1>
          <p className="motion-enter text-text-muted text-lg" style={delay(80)}>
            The global bunnyhop community for Counter-Strike: Source.
          </p>
        </div>
        <div
          className="motion-enter flex flex-wrap items-center gap-3"
          style={delay(160)}
        >
          <ButtonLink href="/servers" variant="primary">
            Find a server
          </ButtonLink>
          <ButtonLink href="/maps">Browse maps</ButtonLink>
        </div>
      </div>
    </header>
  );
}

function delay(ms: number): CSSProperties {
  return { "--motion-delay": `${ms}ms` } as CSSProperties;
}
