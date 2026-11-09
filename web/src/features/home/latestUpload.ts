import { cacheLife } from "next/cache";
import { formatSince } from "../runs/time";

export const youtubeChannel = "https://www.youtube.com/@SourceJump";
const channelId = "UCyEAWx-xBlI-uP2RkqaG43A";

function text(xml: string, tag: string): string | undefined {
  const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
  if (!value) return undefined;
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
      (_, entity: string) => {
        if (!entity.startsWith("#")) return entities[entity.toLowerCase()]!;
        const hex = entity.slice(1, 2).toLowerCase() === "x";
        return String.fromCodePoint(
          parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10),
        );
      },
    )
    .trim();
}

/** Read the known fields of YouTube's Atom feed; titles and descriptions stay plain text. */
export function parseUploadFeed(xml: string) {
  const uploads = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g))
    .map((match) => {
      const entry = match[1]!;
      const id = text(entry, "yt:videoId");
      const title = text(entry, "title");
      const publishedAt = text(entry, "published");
      if (
        text(entry, "yt:channelId") !== channelId ||
        !id ||
        !/^[\w-]{11}$/.test(id) ||
        !title ||
        !publishedAt ||
        !Number.isFinite(Date.parse(publishedAt))
      )
        return null;
      const description = text(entry, "media:description") ?? "";
      const views = entry.match(/<media:statistics\b[^>]*\bviews="(\d+)"/)?.[1];
      return {
        id,
        title,
        publishedAt,
        views: views === undefined ? undefined : Number(views),
        map: description.match(/^Map:\s*(.+)$/m)?.[1]?.trim(),
        player: description.match(/^Player:\s*(.+)$/m)?.[1]?.trim(),
        time: description.match(
          /^Time:\s*(\d+(?::\d{2}){0,2}\.\d{3})\s*$/m,
        )?.[1],
      };
    })
    .filter((upload) => upload !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (!uploads[0]) throw new Error("YouTube feed contains no valid uploads");
  return uploads[0];
}

export async function latestUpload() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 });
  const response = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw new Error(`YouTube feed returned ${response.status}`);
  const upload = parseUploadFeed(await response.text());
  const highResolution = `https://i.ytimg.com/vi/${upload.id}/maxresdefault.jpg`;
  // Some uploads have no maximum-resolution thumbnail; keep the standard version available.
  const image = await fetch(highResolution, {
    method: "HEAD",
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  return {
    ...upload,
    thumbnail: image?.ok
      ? highResolution
      : `https://i.ytimg.com/vi/${upload.id}/hqdefault.jpg`,
    age: formatSince(upload.publishedAt),
  };
}
