import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Legacy v2 pages were removed; keep old links working (query strings are preserved).
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
};

export default nextConfig;
