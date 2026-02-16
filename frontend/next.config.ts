import type { NextConfig } from "next";
import path from "path";

// Frontend es independiente (no workspace): todas las deps están en frontend/node_modules.
const frontendRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  turbopack: {
    root: frontendRoot,
  },
  outputFileTracingRoot: frontendRoot,
};

export default nextConfig;
