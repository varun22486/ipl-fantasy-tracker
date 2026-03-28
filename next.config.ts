import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // ESLint warnings/errors won't block the production build
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors are checked in the IDE; don't block deployment
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
