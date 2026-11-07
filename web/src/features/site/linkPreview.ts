// What a link to one of the site's pages shows when it's shared on Discord, Steam or elsewhere: a title, a short
// description and a picture, as Open Graph and Twitter card tags. Bots that build these previews get the tags in
// the page's head (Next.js waits for them, unlike for browsers).
import type { Metadata } from "next";

type Picture =
  /** Wide, such as a map's cover: shown large under the text. */
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
  picture?: Picture;
}): Metadata {
  const images = picture
    ? [
        picture.wide
          ? { url: picture.url, width: picture.width, height: picture.height }
          : { url: picture.url },
      ]
    : undefined;
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
      card: picture?.wide ? "summary_large_image" : "summary",
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
