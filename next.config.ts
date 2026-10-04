import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      source: "/",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    },
    {
      source: "/nuovo",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    },
    {
      source: "/rilievo/:path*",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    },
  ],
};

export default nextConfig;
