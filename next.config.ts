import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge would show up in captured experiment frames.
  devIndicators: false,
  // Native addons, loaded from node_modules instead of bundled: the local retrieval model's ONNX
  // runtime (transformers.js, lib/retrieval/embed.ts) and Moss's core (@moss-js/moss-core).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "@moss-js/moss", "@moss-js/moss-core"],
  // Other sessions' git worktrees live under .claude/; their edits shouldn't rebuild (and reload) this app.
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/.claude/**", "**/.git/**"] };
    return config;
  },
};

export default nextConfig;
