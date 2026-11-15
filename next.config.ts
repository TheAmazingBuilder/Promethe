import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Dev assets (/_next/*) are served through the sandbox preview proxy.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
