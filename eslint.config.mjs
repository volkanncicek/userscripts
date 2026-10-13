import js from "@eslint/js";
import userscripts from "eslint-plugin-userscripts";
import globals from "globals";

export default [
  { ignores: ["node_modules/"] },
  js.configs.recommended,
  {
    files: ["**/*.user.js"],
    plugins: { userscripts },
    languageOptions: {
      ecmaVersion: "latest",
      // Userscripts are classic scripts injected into the page, not modules.
      sourceType: "script",
      globals: { ...globals.browser, ...globals.greasemonkey },
    },
    rules: {
      ...userscripts.configs.recommended.rules,
      // @include stays where no @match can express the pattern (a wildcard inside a hostname, a regex over any
      // host's path); a comment inside the metadata block to silence it per line is itself invalid metadata.
      "userscripts/better-use-match": "off",
      strict: ["error", "function"],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
      "no-console": "off",
      curly: ["error", "multi-line"],
      "object-shorthand": "error",
      "prefer-template": "error",
    },
  },
  {
    files: ["tools/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node },
  },
];
