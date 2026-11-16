# @sebela/config

Shared ESLint, TypeScript and Prettier configuration for every app and package in the workspace. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A configuration package, not a library with runtime behaviour. It has no build step: consumers load the files directly. It may not import anything else from this repository (see the dependency table in `docs/repository-structure.md`).

## Public interface

Only the subpaths declared in `exports` of `package.json` are public. Nothing else is imported from outside the package.

| Export                              | File                 | What it provides                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sebela/config/eslint`             | `eslint.js`          | `createConfig({ tsconfigRootDir })` — the complete flat config for a package or the root: ignores build output and caches; ESLint recommended rules with Node.js globals for `*.js`, `*.mjs`, `*.cjs` (no type information); `typescript-eslint` strict and stylistic type-checked rules for `*.ts`, `*.tsx`, `*.mts`, `*.cts` through the TypeScript project service; the `sebela/import-boundaries` rule as an error on all of them; unused disable directives are errors. |
| `@sebela/config/prettier`           | `prettier.js`        | The Prettier options (Prettier defaults with a print width of 100).                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@sebela/config/tsconfig.base.json` | `tsconfig.base.json` | Strict TypeScript compiler options for Node.js ESM (`nodenext`, ES2024, `strict` plus the additional checks listed in `docs/code-standards.md`). It loads no ambient `types` and sets no `include` or output; each package adds those itself (for example `"types": ["node"]`).                                                                                                                                                                                              |

## Private files

| File                          | What it is                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import-boundaries.js`        | The `sebela/import-boundaries` rule, registered by `createConfig` under the plugin name `sebela`. It encodes the dependency table of `docs/repository-structure.md` in its `DEPENDENCIES` map and runs the package checks, then the module checks; behaviour, usage and limits are documented there.                  |
| `import-resolution.js`        | Where a specifier leads: the workspace root and members, `exports` and `imports` maps, and `paths` aliases through TypeScript's module resolution. Shared by the rule and the module graph.                                                                                                                           |
| `module-graph.js`             | The backend module layout: the module a file belongs to, its entry, tooling configurations, and the cycle search over a member's modules, which reads and parses the member's source files with TypeScript (cached per file version).                                                                                 |
| `fixture-workspace.js`        | Test support: copies a fixture workspace to a disposable directory and lints files there with `createConfig`, so the tests also prove that the shared configuration enables the rule.                                                                                                                                 |
| `import-boundaries.test.js`   | Behaviour tests of the dependency table, entry points, paths and aliases. Each case writes a file into a disposable copy of `fixtures/import-boundaries/` and lints it.                                                                                                                                               |
| `module-boundaries.test.js`   | Behaviour tests of the module checks: private module files in every checked form, aliases, package exports, the tooling exception and module cycles. The committed files of `fixtures/module-boundaries/` must lint without any error; each negative case writes its own files under module names no other case uses. |
| `fixtures/import-boundaries/` | A fictional miniature workspace: the `pnpm-workspace.yaml` marker, a tsconfig for the type-aware rules (with `paths` aliases), `package.json` files declaring `exports` and `imports`, and an allowed and a forbidden source file.                                                                                    |
| `fixtures/module-boundaries/` | A fictional miniature of the agreed phase 2 layout of `apps/api`, `packages/services` and `packages/db` that follows the module rules: modules using each other through entries, composition and CLI code, colocated tests, private drivers and a tooling configuration.                                              |

The fixture workspaces are not workspace members. They are excluded from this package's own lint, and the `test` task runs only the package's own `*.test.js` files, never fixture sources.

## How a package uses it

```jsonc
// package.json
"devDependencies": { "@sebela/config": "workspace:*", "eslint": "catalog:", "typescript": "catalog:" }
```

```js
// eslint.config.js
import { createConfig } from "@sebela/config/eslint";

export default createConfig({ tsconfigRootDir: import.meta.dirname });
```

```jsonc
// tsconfig.json
{ "extends": "@sebela/config/tsconfig.base.json", "include": ["src"] }
```

Prettier is configured once, in the root `prettier.config.js`, which re-exports `@sebela/config/prettier`. Packages do not add their own Prettier configuration.

## Rules for changing it

- A change here changes every consumer. Run the root `pnpm lint` and `pnpm typecheck`, not just this package's tasks.
- Rule sets are tightened, not loosened. Turning off a rule or a compiler check needs the owner's approval, and so does an inline disable anywhere in the repository.
- Tool versions live in the `catalog` of `pnpm-workspace.yaml`. `typescript` stays within the range `typescript-eslint` supports (its peer dependency); update both together.
- Keep the conventions in `docs/code-standards.md` and the export table above in step with the files.
- A change to the dependency table in `docs/repository-structure.md` changes `DEPENDENCIES` in `import-boundaries.js` and its tests in the same pull request. A new rule behaviour starts with a failing case in `import-boundaries.test.js` (packages, entries, paths) or `module-boundaries.test.js` (modules, tooling, cycles).
- The cycle search costs file reads and TypeScript parses. Each linted file that imports within its own member builds its own module graph; parsed specifiers are cached per file version for the whole lint run, while unit dependencies are cached only per linted file. If lint time of a large member grows noticeably, cache the member's dependency graph per lint run (keyed by the file versions) instead of widening what a single file reads.

## Checks

| Task        | Command                                  | What it checks                                                                                                                     |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `lint`      | `pnpm --filter @sebela/config lint`      | The package's own files with its own ESLint configuration.                                                                         |
| `typecheck` | `pnpm --filter @sebela/config typecheck` | The JavaScript configuration files against the types of ESLint, `typescript-eslint` and Prettier (`checkJs` with the strict base). |
| `test`      | `pnpm --filter @sebela/config test`      | The import-boundaries and module-boundaries behaviour tests, with Node's built-in test runner (`node --test "*.test.js"`).         |

The rule is tested because it is behaviour; the rest of the package is configuration, and tests that restate configuration are not written (`docs/testing.md`). That configuration is exercised by every consumer's `lint` and `typecheck` task.
