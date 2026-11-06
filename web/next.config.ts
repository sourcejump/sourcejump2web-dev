import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the VPS (ADR 0005).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // 75 is the default for every image. The home banner asks for 90: at 75 its film grain is smoothed away and
    // the fog looks flat; 90 keeps it for about 80 KB at full size.
    qualities: [75, 90],
  },
  // In production Caddy sends /v1/* to the API before the web app sees it. In development this does the
  // same, so the browser reaches both on one origin, as sign-in cookies require. Development only: Next matches
  // rewrites without regard to case, so in production `/V1/...` would slip past Caddy's case-sensitive match
  // and reach the API through this proxy, which buffers whole request bodies before the API checks anything.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.SJ_API_URL ?? "http://127.0.0.1:8080";
    return [{ source: "/v1/:path*", destination: `${api}/v1/:path*` }];
  },
  experimental: {
    // That proxying buffers request bodies, cut off at 10 MB by default; a packed map can be up to the API's
    // 256 MB (`staff/map_viewer_file.rs`).
    proxyClientMaxBodySize: "256mb",
    // Pages block on their data by design (`instant = false` in the root layout), so don't warn about it.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
