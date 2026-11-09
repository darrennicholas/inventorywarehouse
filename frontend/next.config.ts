import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentUpgrade: "security",
  },
  // Hide the Next.js developer tools badge from the application UI.
  devIndicators: false,
  // Keep browser warnings/errors visible in the terminal during development.
  logging: { browserToTerminal: "warn" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
