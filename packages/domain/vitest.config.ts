import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/result.ts", "src/errors/**/*.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
      },
    },
  },
});
