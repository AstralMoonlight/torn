import type { NextConfig } from "next";
import path from "path";

// Frontend es independiente (no workspace): todas las deps están en frontend/node_modules.
const frontendRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  turbopack: {
    root: frontendRoot,
  },
  outputFileTracingRoot: frontendRoot,
  // Genera .next/standalone: un servidor autocontenido con sólo las
  // dependencias que el build rastrea. Es lo que copia la etapa `runner` de
  // Dockerfile.frontend, en vez de arrastrar node_modules entero.
  // No afecta a `npm run dev`.
  output: "standalone",
};

export default nextConfig;
