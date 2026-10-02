import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Server actions take a positional `(prevState, formData)` shape because
      // `useActionState` requires it, and several of them — the deletes in
      // particular — have no form fields to read and no previous state to
      // carry forward. Those parameters are real: the hook's generic inference
      // reads their types. So an unused one is prefixed with `_` rather than
      // dropped, and the ignore pattern is what makes that prefix count.
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
    // The e2e suite builds into its own directory (playwright.config.ts sets
    // NEXT_DIST_DIR) so it never contends with `pnpm dev` over the Next.js lock
    // on `.next`. `.gitignore` only covers `/.next/`, so without this the linter
    // walks the generated e2e bundle and reports its output as project errors.
    ".next-e2e/**",
  ]),
]);

export default eslintConfig;
