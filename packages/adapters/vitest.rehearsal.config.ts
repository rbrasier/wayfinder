import { defineConfig } from "vitest/config";

// Tests that rehearse a deployment step against a real Postgres. DATABASE_URL
// must point at a server where this role can create and drop databases.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.rehearsal.test.ts"],
    testTimeout: 60_000,
  },
});
