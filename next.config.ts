import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge would show up in captured experiment frames.
  devIndicators: false,
  // Other sessions' git worktrees live under .claude/; their edits shouldn't rebuild (and reload) this app.
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/.claude/**", "**/.git/**"] };
    return config;
  },
};

export default nextConfig;
