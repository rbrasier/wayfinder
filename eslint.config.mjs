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
    // `ApprovalStatus` carries a value the compiler cannot police at comparison
    // sites: a `status === "approved"` written later would silently exclude
    // every approval its own approver edited (ADR-045 §4). Nothing in the
    // codebase has that shape today, so this rule is what keeps it that way —
    // it turns a future silent bug into a build failure.
    //
    // Deliberately narrow: it matches a comparison against a `.status` property
    // only, so `input.decision === "approved"` — reading `ApprovalDecision`,
    // which keeps its three values and drives all control flow — stays legal.
    // `"pending"` is absent from the set because the decided-guard
    // (`status !== "pending"`) is correct and stays correct with a fourth
    // decided value.
    files: ["packages/application/**/*.ts", "packages/adapters/**/*.ts", "apps/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator=/^[!=]==$/][left.property.name='status'][right.value=/^(approved|approved_with_edits|rejected|changes_requested)$/]",
          message:
            "Do not compare an approval status to a literal — an `approved_with_edits` approval did approve. Use isApproved(status) from @wayfinder/domain.",
        },
        {
          selector:
            "BinaryExpression[operator=/^[!=]==$/][right.property.name='status'][left.value=/^(approved|approved_with_edits|rejected|changes_requested)$/]",
          message:
            "Do not compare an approval status to a literal — an `approved_with_edits` approval did approve. Use isApproved(status) from @wayfinder/domain.",
        },
      ],
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
                "@wayfinder/adapters",
                "@wayfinder/adapters/*",
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
                "packages/application may only import @wayfinder/domain and @wayfinder/shared.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
