import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge would show up in captured experiment frames.
  devIndicators: false,
};

export default nextConfig;
