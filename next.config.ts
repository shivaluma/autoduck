import type { NextConfig } from "next";

/**
 * Transition (plan Phase 4): Next serves only the API route handlers in app/api. Pages are the Vite SPA
 * (index.html, src/).
 *
 * - Development: `pnpm dev` runs both; Vite (:5173) proxies /api to this server on :3000.
 * - Production image: the Dockerfile copies the SPA build (dist/) into public/, so Next serves its assets
 *   as static files, and the fallback rewrite below answers every other non-API path with the SPA's
 *   index.html (the client router then renders the route or its 404).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  // Next rewrites the tsconfig it type-checks with; keep those edits out of the Vite tsconfig.json.
  typescript: { tsconfigPath: "tsconfig.next.json" },
  // Legacy v2 pages were removed; keep old links working (query strings are preserved). The SPA router
  // (src/router.tsx) has the same redirects.
  async redirects() {
    return [
      { source: "/rules", destination: "/season-3/rules", permanent: false },
      { source: "/admin/dashboard", destination: "/admin/season-3", permanent: false },
      { source: "/dragon", destination: "/season-3", permanent: false },
      { source: "/members", destination: "/season-3", permanent: false },
      { source: "/race/new", destination: "/season-3", permanent: false },
      { source: "/race/:id", destination: "/season-3/race/:id", permanent: false },
    ];
  },
  // The SPA's hashed build files (dist/assets → public/assets) never change under a name.
  async headers() {
    return [{ source: "/assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  async rewrites() {
    return {
      // Checked after route handlers and public/ files. Only page paths get the SPA: never /api or /api/*
      // (the API answers its own 404s), /_next/*, or a path whose last segment has a dot (a missing file,
      // e.g. a chunk from an older build, must be a 404, not index.html). Same rule as the Rust server.
      fallback: [{ source: "/:path((?!api(?:/|$)|_next/)(?!.*\\.[^/]*$).*)", destination: "/index.html" }],
    };
  },
};

export default nextConfig;
