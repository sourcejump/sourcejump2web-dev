import { afterEach, expect, it, vi } from "vitest";
import { latestUpload, parseUploadFeed } from "./latestUpload";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

const entry = (id: string, date: string, description = "") => `<entry>
  <yt:videoId>${id}</yt:videoId>
  <yt:channelId>UCyEAWx-xBlI-uP2RkqaG43A</yt:channelId>
  <title>bhop_test in 1:15 by A &amp; B</title>
  <published>${date}</published>
  <media:description>${description}</media:description>
  <media:statistics views="0"/>
</entry>`;
const feed = `<feed>${entry("abcdefghijk", "2026-11-01T12:00:00Z")}${entry("v7AFSKcOvSE", "2026-11-08T22:21:09Z", "Player: A &amp; B\nMap: bhop_&#116;est\nTime: 1:15.784")}</feed>`;

afterEach(() => vi.unstubAllGlobals());

it("chooses the newest published upload and reads real run details and zero views", () => {
  expect(parseUploadFeed(feed)).toMatchObject({
    id: "v7AFSKcOvSE",
    title: "bhop_test in 1:15 by A & B",
    views: 0,
    player: "A & B",
    map: "bhop_test",
    time: "1:15.784",
  });
});

it("keeps a normal upload usable without run details or view counts", () => {
  const upload = parseUploadFeed(
    feed
      .replace(/<media:description>[\s\S]*?<\/media:description>/g, "")
      .replace(/<media:statistics[^>]*\/>/g, ""),
  );
  expect(upload.title).toBeTruthy();
  expect(upload.map).toBeUndefined();
  expect(upload.views).toBeUndefined();
});

it("rejects malformed feeds and entries from another channel", () => {
  expect(() => parseUploadFeed("<feed/>")).toThrow();
  expect(() =>
    parseUploadFeed(
      feed.replaceAll("UCyEAWx-xBlI-uP2RkqaG43A", "another-channel"),
    ),
  ).toThrow();
  expect(() =>
    parseUploadFeed(
      feed.replaceAll(
        /<published>.*?<\/published>/g,
        "<published>not-a-date</published>",
      ),
    ),
  ).toThrow();
});

it("uses a standard thumbnail when a high-resolution version is unavailable", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(feed))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  const upload = await latestUpload();
  expect(upload.thumbnail).toBe(
    "https://i.ytimg.com/vi/v7AFSKcOvSE/hqdefault.jpg",
  );
});

const channelPage = `<script>var ytInitialData = {"contentId":"v7AFSKcOvSE","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"};</script>`;
const watchPage = (channel = "UCyEAWx-xBlI-uP2RkqaG43A") =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    videoDetails: {
      videoId: "v7AFSKcOvSE",
      channelId: channel,
      title: "bhop_test in 1:15 by A & B",
      viewCount: "1749",
      shortDescription: "Player: A & B\nMap: bhop_test\nTime: 1:15.784",
    },
    microformat: {
      playerMicroformatRenderer: { publishDate: "2026-11-08T14:21:09-08:00" },
    },
  })};</script>`;

it("reads the latest channel upload when YouTube's feed returns 404", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(channelPage))
    .mockResolvedValueOnce(new Response(watchPage()))
    .mockResolvedValueOnce(new Response(null));
  vi.stubGlobal("fetch", fetch);
  const upload = await latestUpload();
  expect(upload).toMatchObject({
    id: "v7AFSKcOvSE",
    player: "A & B",
    time: "1:15.784",
    views: 1749,
    publishedAt: "2026-11-08T14:21:09-08:00",
  });
  expect(fetch.mock.calls[2]![0]).toBe(
    "https://www.youtube.com/watch?v=v7AFSKcOvSE",
  );
});

it("rejects a channel-page video that belongs to another channel", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(channelPage))
      .mockResolvedValueOnce(new Response(watchPage("another-channel"))),
  );
  await expect(latestUpload()).rejects.toThrow("invalid");
});

it("surfaces feed failures so the component can show its channel fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
  );
  await expect(latestUpload()).rejects.toThrow("503");
});
