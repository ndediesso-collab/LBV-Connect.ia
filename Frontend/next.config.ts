
import type { NextConfig } from "next";

const privatePagePatterns = [
  "/chat/:path*",
  "/conversations/:path*",
  "/credits/:path*",
  "/mes_creations/:path*",
  "/settings/:path*",
  "/packs/:path*",
  "/login/:path*",
  "/register/:path*",
  "/oria-visual-embed/:path*",
];

const nextConfig: NextConfig = {
  async headers() {
    return privatePagePatterns.map((source) => ({
      source,
      headers: [
        {
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive",
        },
      ],
    }));
  },
};

export default nextConfig;
