import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**", "cdk.out/**"],
    // One container, one schema, one database: these tests share state by
    // design and must not interleave.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
