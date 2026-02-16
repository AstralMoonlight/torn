import type { NextConfig } from "next";
import path from "path";

const frontendRoot = path.resolve(__dirname);
const monorepoRoot = path.resolve(__dirname, "..");

// En dev: raíz solo del frontend → Next no indexa todo el monorepo (evita consumo excesivo de RAM).
// En build: raíz del monorepo → resuelve todas las deps que npm workspaces deja en la raíz.
const isDev = process.env.NODE_ENV !== "production";
const root = isDev ? frontendRoot : monorepoRoot;

const nextConfig: NextConfig = {
  turbopack: {
    root,
  },
  outputFileTracingRoot: root,
};

export default nextConfig;
