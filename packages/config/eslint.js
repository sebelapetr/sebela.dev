// @ts-check

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import importBoundaries from "./import-boundaries.js";

const JS_FILES = ["**/*.{js,mjs,cjs}"];
const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];

/**
 * @typedef {object} ConfigOptions
 * @property {string} tsconfigRootDir Directory of the calling `eslint.config.js`, usually
 *   `import.meta.dirname`. Type-aware rules resolve the nearest `tsconfig.json` from here.
 */

/**
 * The shared ESLint configuration for a workspace package or the repository root.
 *
 * - Build output and caches are ignored.
 * - JavaScript files get ESLint's recommended rules with Node.js globals and no type information,
 *   so plain Node scripts lint without a tsconfig.
 * - TypeScript files get typescript-eslint's strict and stylistic type-checked rules, resolved
 *   through the TypeScript project service against the nearest `tsconfig.json`.
 * - Every JavaScript and TypeScript file is checked by `sebela/import-boundaries`, which enforces
 *   the dependency table and the API trust boundary of `docs/repository-structure.md`.
 * - A disable directive that no longer suppresses anything is an error.
 *
 * Callers add their own `globalIgnores` or overrides after it.
 *
 * @param {ConfigOptions} options
 */
export function createConfig({ tsconfigRootDir }) {
  return defineConfig(
    globalIgnores(["**/dist/", "**/coverage/", "**/.turbo/", "**/.next/"]),
    {
      linterOptions: {
        reportUnusedDisableDirectives: "error",
      },
    },
    {
      files: JS_FILES,
      extends: [js.configs.recommended],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: globals.node,
      },
    },
    {
      files: TS_FILES,
      extends: [
        js.configs.recommended,
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
      ],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
    },
    {
      files: [...JS_FILES, ...TS_FILES],
      plugins: {
        sebela: {
          meta: { name: "@sebela/config" },
          rules: { "import-boundaries": importBoundaries },
        },
      },
      rules: {
        "sebela/import-boundaries": "error",
      },
    },
  );
}
