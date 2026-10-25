import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge would show up in captured experiment frames.
  devIndicators: false,
  // Moss ships a native addon (@moss-js/moss-core); load it from node_modules instead of bundling it.
  serverExternalPackages: ["@moss-js/moss", "@moss-js/moss-core"],
  // Other sessions' git worktrees live under .claude/; their edits shouldn't rebuild (and reload) this app.
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/.claude/**", "**/.git/**"] };
    return config;
  },
};

export default nextConfig;
