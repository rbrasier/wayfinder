import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Standalone config: deploy/lambda is outside the pnpm workspace (ADR-056 §2),
// so the root config does not reach it and this is what its CI job runs.
export default tseslint.config(
  { ignores: ["node_modules/**", "cdk.out/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly" },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
);
