// Flat ESLint config (ESLint 9+). Replaces the legacy .eslintrc.cjs so the
// lint pass works under modern ESLint, where eslintrc configs and the
// --ext / --no-eslintrc CLI flags have been removed.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/*.config.cjs",
      "**/*.config.mjs",
      "**/*.config.ts",
      "**/drizzle/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Match the legacy eslintrc default, which did not flag unused
    // eslint-disable directives, so intentional lint pragmas are preserved.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    // packages/domain purity is enforced by validate.sh via a grep —
    // ESLint's no-restricted-imports cannot cleanly distinguish
    // "non-relative" imports from relative ones using its glob patterns.
    // See validate.sh check 5.
    files: ["packages/application/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@rbrasier/adapters",
                "@rbrasier/adapters/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "ai",
                "@ai-sdk/*",
                "@langchain/*",
                "@langfuse/*",
                "next",
                "next/*",
                "express",
              ],
              message:
                "packages/application may only import @rbrasier/domain and @rbrasier/shared.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
