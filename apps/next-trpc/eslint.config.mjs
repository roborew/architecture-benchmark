import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The e2e suite's own build directory (NEXT_DIST_DIR=.next-e2e). Listed in
    // .gitignore; eslint needs it too or it lints generated bundles and reports
    // their `require()` calls and `@ts-ignore`s as our own errors.
    ".next-e2e/**",
  ]),
]);

export default eslintConfig;
