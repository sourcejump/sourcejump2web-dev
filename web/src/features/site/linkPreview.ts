// What a link to one of the site's pages shows when it's shared on Discord, Steam or elsewhere: a title, a short
// description and a picture, as Open Graph and Twitter card tags. Bots that build these previews get the tags in
// the page's head (Next.js waits for them, unlike for browsers).
import type { Metadata } from "next";

/** Link cards' size, as the API draws them (`maps/card.rs`). */
const CARD = { width: 1200, height: 630 };

/**
 * The site's card, for pages without a picture of their own: drawn by the API's `site-card` command from the
 * home page's header picture, and served from `public/`.
 */
export const SITE_CARD: Picture = {
  url: "/link-card.jpg",
  ...CARD,
  wide: true,
};

/** A card the API drew, such as a map's (`card_url`). */
export function card(url: string): Picture {
  return { url, ...CARD, wide: true };
}

export type Picture =
  /** Wide, such as a map's card: shown large under the text. */
  | { url: string; width: number; height: number; wide: true }
  /** Small and square, such as an avatar: shown beside the text. */
  | { url: string; wide: false };

export function linkPreview({
  title,
  description,
  picture,
}: {
  title: string;
  description: string;
  /** Left out, the site's card. */
  picture?: Picture;
}): Metadata {
  const shown = picture ?? SITE_CARD;
  const images = [
    shown.wide
      ? { url: shown.url, width: shown.width, height: shown.height }
      : { url: shown.url },
  ];
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "SourceJump",
      type: "website",
      images,
    },
    twitter: {
      card: shown.wide ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  };
}

/** "1 player", "44 players". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
