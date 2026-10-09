import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container runs the traced standalone server (`node server.js`) rather
  // than the full `next start`, so the runtime image ships only what it uses.
  output: "standalone",

  /* config options here */

  // The e2e suite starts its own dev server against the isolated test
  // database. Next.js takes a lock on the build directory, so sharing one
  // would make the e2e server refuse to start whenever a developer had
  // `pnpm dev` running. NEXT_DIST_DIR lets the e2e server use a sibling
  // directory instead; normal development is unaffected.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  // Pages that have not yet moved to the database layer still import their mock
  // data from `@tests/*` (see tests/fixtures/data.ts). This mirrors the
  // tsconfig path so the dev and test servers resolve it identically. When the
  // last such page moves to `src/lib/data.ts`, this can go.
  turbopack: {
    resolveAlias: {
      "@tests": "./tests",
    },
  },
};

export default nextConfig;
