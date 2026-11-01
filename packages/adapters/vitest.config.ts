import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Needs a real Postgres; runs from `db:rehearse-upgrade` instead.
    exclude: [...configDefaults.exclude, "**/*.rehearsal.test.ts"],
  },
});
