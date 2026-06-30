// Flat ESLint config (ESLint 9+) for the web app. Replaces the legacy
// .eslintrc.cjs. Extends the workspace TypeScript rules and layers the
// jsx-a11y "strict" ruleset on top so the UI stays WCAG 2.2 AA accessible.
//
// jsx-a11y covers the machine-checkable subset of WCAG: alt text, form labels,
// valid ARIA, keyboard handlers paired with mouse handlers, no positive
// tabindex, etc. The runtime-only criteria (colour contrast, focus order,
// target size) are documented in docs/accessibility.md and audited manually.
//
// Keep the jsx-a11y rule set here in sync with eslint.config.a11y.js, which
// validate.sh runs in isolation so a11y regressions fail CI even if the
// general lint is weakened.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: {
      "jsx-a11y": {
        // Map the project's component primitives to their underlying elements
        // so the linter checks them as the real interactive element.
        components: {
          Button: "button",
          Input: "input",
          Textarea: "textarea",
          Label: "label",
        },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",

      // ── WCAG 2.2 AA — explicit a11y rules promoted to errors ──────────────
      // jsx-a11y/strict already enables these; pinning them here documents the
      // WCAG success criteria they map to and prevents silent downgrades.
      "jsx-a11y/alt-text": "error", // 1.1.1 Non-text Content
      "jsx-a11y/anchor-has-content": "error", // 2.4.4 Link Purpose
      "jsx-a11y/anchor-is-valid": "error", // 2.1.1 Keyboard
      "jsx-a11y/aria-props": "error", // 4.1.2 Name, Role, Value
      "jsx-a11y/aria-proptypes": "error", // 4.1.2
      "jsx-a11y/aria-role": "error", // 4.1.2
      "jsx-a11y/aria-unsupported-elements": "error", // 4.1.2
      "jsx-a11y/click-events-have-key-events": "error", // 2.1.1 Keyboard
      "jsx-a11y/heading-has-content": "error", // 1.3.1 Info and Relationships
      "jsx-a11y/html-has-lang": "error", // 3.1.1 Language of Page
      "jsx-a11y/iframe-has-title": "error", // 2.4.1 / 4.1.2
      "jsx-a11y/img-redundant-alt": "error", // 1.1.1
      "jsx-a11y/interactive-supports-focus": "error", // 2.1.1 Keyboard
      "jsx-a11y/label-has-associated-control": "error", // 1.3.1 / 3.3.2 Labels
      "jsx-a11y/no-autofocus": "error", // 2.4.3 Focus Order
      "jsx-a11y/mouse-events-have-key-events": "error", // 2.1.1 Keyboard
      "jsx-a11y/no-noninteractive-element-interactions": "error", // 4.1.2
      "jsx-a11y/no-noninteractive-tabindex": "error", // 2.4.3
      "jsx-a11y/no-redundant-roles": "error", // 4.1.2
      "jsx-a11y/no-static-element-interactions": "error", // 2.1.1 Keyboard
      "jsx-a11y/role-has-required-aria-props": "error", // 4.1.2
      "jsx-a11y/role-supports-aria-props": "error", // 4.1.2
      "jsx-a11y/tabindex-no-positive": "error", // 2.4.3 Focus Order
    },
  },
  eslintConfigPrettier,
);
