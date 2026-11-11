import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Flat config without eslint-config-next (plan D18). It keeps the rule set the Next preset applied to this
 * repo, minus the @next/next rules: typescript-eslint recommended (unused vars/expressions as warnings),
 * react-hooks recommended (including the React Compiler rules), eslint-plugin-react recommended with the
 * same rules off as the preset (plus react/display-name, off in the old config), and the six jsx-a11y
 * rules the preset enabled, as warnings. Not kept: import/no-anonymous-default-export.
 *
 * Browser code (src/, components/) may not use Node globals (`process`, `Buffer`, `__dirname`, …) or Node
 * builtins: they would pass tsc and then throw under Vite.
 */
export default defineConfig([
  globalIgnores([
    "dist/**",
    "out/**",
    "build/**",
    "target/**",
    "public/**",
    // Scratch output (videos, local experiments).
    "tmp/**",
    ".cache/**",
  ]),
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
  },
  {
    // Browser code. typescript-eslint turns off no-undef (tsc checks names, and @types/node is global), so
    // Node globals and builtins are banned by name.
    files: ["src/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["process", "Buffer", "__dirname", "__filename", "global", "require", "module", "setImmediate"].map((name) => ({
          name,
          message: "Node global in browser code (src/, components/): it is undefined under Vite.",
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^node:", message: "Node builtin in browser code (src/, components/)." },
            { regex: "^(fs|path|crypto|os|child_process|url|stream|zlib|util)$", message: "Node builtin in browser code (src/, components/)." },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    ...react.configs.flat.recommended,
    ...react.configs.flat["jsx-runtime"],
    plugins: { react, "jsx-a11y": jsxA11y },
    languageOptions: { ...react.configs.flat.recommended.languageOptions },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      "react/display-name": "off",
      "react/no-unknown-property": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
]);
