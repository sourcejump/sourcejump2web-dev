// Beta's bucket permits the beta origin, so local development proxies public viewer files through Next.
export function replayAssetUrl(url: string): string {
  if (process.env.NODE_ENV !== "development") return url;
  const file = new URL(url);
  return file.origin === "https://files.sourcejump.net"
    ? `${window.location.origin}/_beta-files${file.pathname}${file.search}`
    : url;
}
