// vitest.config.ts
//
// The unit project renders components in jsdom with the router context the
// TanStack components need; no database, no dev server. The e2e tier is
// Playwright (playwright.config.ts), not Vitest.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
          alias: {
            "@": path.resolve(root, "./src"),
            "@tests": path.resolve(root, "./tests"),
          },
        },
      },
    ],
  },
});
