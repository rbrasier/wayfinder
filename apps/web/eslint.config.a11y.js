// Accessibility-only flat ESLint config (ESLint 9+). Runs the jsx-a11y
// "strict" ruleset in isolation (no TypeScript or stylistic rules) so
// validate.sh can gate the build on WCAG 2.2 AA accessibility independently of
// the general lint pass.
//
// Keep the jsx-a11y rule set here in sync with eslint.config.js.
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**"],
  },
  jsxA11y.flatConfigs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    // jsx-a11y/strict ships an espree-based parser that cannot read TypeScript
    // syntax; swap in the TS parser so .ts/.tsx files lint cleanly.
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      "jsx-a11y": {
        components: {
          Button: "button",
          Input: "input",
          Textarea: "textarea",
          Label: "label",
        },
      },
    },
  },
];
