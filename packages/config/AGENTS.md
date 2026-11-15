# @sebela/config

Shared ESLint, TypeScript and Prettier configuration for every app and package in the workspace. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A configuration package, not a library with runtime behaviour. It has no build step: consumers load the files directly. It may not import anything else from this repository (see the dependency table in `docs/repository-structure.md`).

## Public interface

Only the subpaths declared in `exports` of `package.json` are public. Nothing else is imported from outside the package.

| Export                              | File                 | What it provides                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@sebela/config/eslint`             | `eslint.js`          | `createConfig({ tsconfigRootDir })` — the complete flat config for a package or the root: ignores build output and caches; ESLint recommended rules with Node.js globals for `*.js`, `*.mjs`, `*.cjs` (no type information); `typescript-eslint` strict and stylistic type-checked rules for `*.ts`, `*.tsx`, `*.mts`, `*.cts` through the TypeScript project service; unused disable directives are errors. |
| `@sebela/config/prettier`           | `prettier.js`        | The Prettier options (Prettier defaults with a print width of 100).                                                                                                                                                                                                                                                                                                                                          |
| `@sebela/config/tsconfig.base.json` | `tsconfig.base.json` | Strict TypeScript compiler options for Node.js ESM (`nodenext`, ES2024, `strict` plus the additional checks listed in `docs/code-standards.md`). It loads no ambient `types` and sets no `include` or output; each package adds those itself (for example `"types": ["node"]`).                                                                                                                              |

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

## Checks

| Task        | Command                                  | What it checks                                                                                                                     |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `lint`      | `pnpm --filter @sebela/config lint`      | The package's own files with its own ESLint configuration.                                                                         |
| `typecheck` | `pnpm --filter @sebela/config typecheck` | The JavaScript configuration files against the types of ESLint, `typescript-eslint` and Prettier (`checkJs` with the strict base). |

There are no unit tests: the package holds configuration only, and tests that restate configuration are not written (`docs/testing.md`). Its behaviour is exercised by every consumer's `lint` and `typecheck` task.
