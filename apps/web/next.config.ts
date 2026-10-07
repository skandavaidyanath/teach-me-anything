import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tma/schema", "@tma/content"],
};

export default nextConfig;
