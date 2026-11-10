import { cacheLife } from "next/cache";
import { formatSince } from "../runs/time";

export const youtubeChannel = "https://www.youtube.com/@SourceJump";
const channelId = "UCyEAWx-xBlI-uP2RkqaG43A";

function runDetails(description: string) {
  return {
    map: description.match(/^Map:\s*(.+)$/m)?.[1]?.trim(),
    player: description.match(/^Player:\s*(.+)$/m)?.[1]?.trim(),
    time: description.match(/^Time:\s*(\d+(?::\d{2}){0,2}\.\d{3})\s*$/m)?.[1],
  };
}

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
        ...runDetails(description),
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
  const signal = AbortSignal.timeout(8000);
  let upload;
  try {
    const response = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      { signal },
    );
    if (!response.ok)
      throw new Error(`YouTube feed returned ${response.status}`);
    upload = parseUploadFeed(await response.text());
  } catch {
    // YouTube's public feed can return 404 while the channel and videos remain available.
    const channel = await fetch(`${youtubeChannel}/videos`, { signal });
    if (!channel.ok)
      throw new Error(`YouTube channel returned ${channel.status}`);
    const html = await channel.text();
    const id =
      html.match(
        /"contentId":"([\w-]{11})","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"/,
      )?.[1] ?? html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/)?.[1];
    if (!id) throw new Error("YouTube channel contains no upload");
    const watch = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      signal,
    });
    if (!watch.ok) throw new Error(`YouTube video returned ${watch.status}`);
    const player = (await watch.text()).match(
      /var ytInitialPlayerResponse = (.*?);<\/script>/,
    )?.[1];
    if (!player) throw new Error("YouTube video details are unavailable");
    const data = JSON.parse(player) as {
      videoDetails?: {
        videoId: string;
        channelId: string;
        title: string;
        viewCount?: string;
        shortDescription?: string;
      };
      microformat?: { playerMicroformatRenderer?: { publishDate?: string } };
    };
    const details = data.videoDetails;
    const publishedAt =
      data.microformat?.playerMicroformatRenderer?.publishDate;
    if (
      details?.channelId !== channelId ||
      details.videoId !== id ||
      typeof details.title !== "string" ||
      !details.title ||
      !publishedAt ||
      !Number.isFinite(Date.parse(publishedAt))
    )
      throw new Error("YouTube upload details are invalid");
    upload = {
      id,
      title: details.title,
      publishedAt,
      views:
        details.viewCount && /^\d+$/.test(details.viewCount)
          ? Number(details.viewCount)
          : undefined,
      ...runDetails(details.shortDescription ?? ""),
    };
  }
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
