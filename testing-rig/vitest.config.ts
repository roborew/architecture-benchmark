import { defineConfig } from "vitest/config";

// The rig's own tests are node-only and never touch Docker: they cover the
// pure, high-risk logic (schema strictness, token resolution, port/host
// planning, fixture eligibility, command construction). Anything that needs a
// live daemon is exercised by the controller gates instead.
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
});
