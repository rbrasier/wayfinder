import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Playwright e2e specs under e2e/ are driven by the e2e skill, not vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
