/* eslint-env node */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  ignorePatterns: [
    "dist",
    ".next",
    "node_modules",
    "*.config.js",
    "*.config.cjs",
    "*.config.mjs",
    "drizzle",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/consistent-type-imports": "warn",
  },
  overrides: [
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
  ],
};
