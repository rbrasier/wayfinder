import { defineConfig } from "vitest/config";

// Integration tests need a live Postgres and are run by their own script, so a
// bare `npm test` stays infrastructure-free and fast. They never skip
// themselves: run without a database, they fail, which is the point.
export default defineConfig({
  test: {
    exclude: ["node_modules/**", "cdk.out/**", "**/*.integration.test.ts"],
    // Synthesising the stack bundles four handlers with esbuild.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
