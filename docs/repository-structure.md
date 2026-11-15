# Repository structure

Where things live in this monorepo and why. This is the target layout; the number in brackets is the phase in which a part is created (see `.plan/00-overview/prd.md`). Parts from later phases do not exist yet.

## Layout

```
.
├── apps/
│   ├── web/                 Next.js, frontend only [3]
│   │   ├── e2e/             Playwright tests and screenshots
│   │   └── Dockerfile
│   ├── api/                 Hono API, the only gateway to data [2]
│   │   └── Dockerfile
│   ├── mcp-admin/           secured MCP server for content management, TypeScript [5]
│   │   └── evals/
│   └── llm-agent/           the AI layer, Python: chat pipeline and public MCP server [7]
│       └── evals/
├── packages/
│   ├── config/              shared ESLint, TypeScript and Prettier configuration, incl. tsconfig.base.json [1]
│   ├── db/                  Drizzle schema, migrations, repositories [2]
│   │   └── seed/demo/       fictional person; the only seed in the repository
│   ├── services/            domain logic [2]
│   ├── contracts/           Zod schemas and types shared by API, web and MCP [2]
│   ├── api-client/          typed client generated from the OpenAPI document [2]
│   ├── ui/                  shared React components, design tokens [3]
│   └── memory/              indexing and retrieval [6]
├── scripts/
│   ├── run-phase.sh         starts the phase loop [0]
│   └── harness/             the loop, worktree slots, hooks, GitHub set-up — plain Node, no dependencies [0]
├── docs/                    architecture, design, workflow, decisions [1, grows]
├── .plan/                   PRDs and issue overviews, one folder per phase
├── .claude/
│   ├── skills/              grill-me, to-prd, to-issues, later content skills
│   ├── rules/               short rules that point to the relevant docs
│   ├── agents/              orchestrator, backend-, frontend- and ai-developer, reviewer, docs-keeper
│   └── settings.json        hooks and permissions
├── .github/workflows/       CI [1]
├── compose.yaml             base stack: postgres, later api, web, mcp [1]
├── compose.prod.yaml        production overrides [8]
├── turbo.json               task pipeline [1]
├── pnpm-workspace.yaml      workspace packages, tool version catalog [1]
├── pnpm-lock.yaml           committed lockfile [1]
├── package.json             root commands, Node.js and pnpm versions [1]
├── .nvmrc                   Node.js major version [1]
├── eslint.config.js         lints root files: the harness and root configuration [1]
├── prettier.config.js       re-exports the shared Prettier configuration [1]
├── .prettierignore          generated files Prettier leaves alone [1]
├── .env.example
├── AGENTS.md                rules for agents (each app and package also has its own)
├── GLOSSARY.md              canonical domain terms
├── README.md
└── LICENSE
```

Two folders are tracked only as a one-line `README.md`; everything else in them is ignored by git:

- `.context/` — the owner's raw private working notes. Agents do not read them.
- `.worktrees/` — agent worktrees, slot bookkeeping and loop logs.

Also not in git: `.env`, `.env.local`.

Agents may read and edit `.env.local` only inside their assigned worktree, with their session running there. It contains development configuration only; production credentials stay outside development worktrees. The guard and the exact limits are described in `docs/permissions.md`.

## Conventions

- **Package scope:** `@sebela/*`, for example `@sebela/db`.
- **Apps are deployables, packages are libraries.** An app never imports another app.
- **Dockerfiles** live in the app they build. Compose files live in the repository root.
- **Tests** sit next to the code they test. Only end-to-end tests (`apps/web/e2e/`) and evals (the `evals/` folder of `mcp-admin`, `llm-agent` and `memory`) have their own folders.
- **Two languages:** everything is TypeScript except `apps/llm-agent`, which is Python with its own toolchain. It is part of the monorepo's task pipeline and CI like any other app.
- **Seeds:** the repository contains only the fictional demo seed. The owner's real data is loaded once from a private seed outside the repository, in the same format, through the same command.
- **Language:** code, docs, `AGENTS.md`, README and PRDs are in English.
- **Agent instructions:** the root `AGENTS.md` holds repository-wide rules; every app and package has its own `AGENTS.md` with what is specific to it. There are no `CLAUDE.md` files: Claude Code reads `AGENTS.md` directly when no `CLAUDE.md` exists, and other coding agents read it too.

## Toolchain and workspace

| Tool | Version | Declared in |
| --- | --- | --- |
| Node.js | 26, the current LTS line | `.nvmrc` (`26`) and `engines.node` in `package.json` (`>=26.0.0 <27.0.0`). `engineStrict` in `pnpm-workspace.yaml` makes installation fail on another version. |
| pnpm | 12.21.0 | `packageManager` in `package.json`. CI installs exactly this version. |
| Turborepo, ESLint, TypeScript, Prettier, typescript-eslint | Exact versions | The `catalog` in `pnpm-workspace.yaml`; packages depend on them with `catalog:`. |

- **Prerequisites:** Git, Node.js 26 and pnpm 12.21.0. Install that pnpm version directly (for example `npm install --global pnpm@12.21.0`): pnpm 10 cannot switch itself to the native pnpm 12 executable, so an older global pnpm fails instead of switching.
- **Installation is locked:** `pnpm install --frozen-lockfile` installs exactly what `pnpm-lock.yaml` records. Change dependencies with `pnpm add` / `pnpm remove` and commit the updated lockfile in the same change.
- **TypeScript stays on 6.0** while `typescript-eslint`, which needs the TypeScript compiler API, supports only `<6.1.0`. Move both together.
- **Workspace members:** `apps/*` and `packages/*`. Every member is a `@sebela/*` package with its own `AGENTS.md`. A package defines only the tasks it can meaningfully run.

### Root commands

Run from the repository root. Turborepo runs a task in every package that defines it, after the `build` of the packages it depends on, and caches the result.

| Command | What it runs |
| --- | --- |
| `pnpm install --frozen-lockfile` | The locked installation, as in CI |
| `pnpm lint` | `lint` of every package, plus ESLint over the root files (`lint:root`: the harness and root configuration) |
| `pnpm typecheck` | `typecheck` of every package |
| `pnpm test` | `test` of every package, plus the harness tests (`test:harness`) |
| `pnpm build` | `build` of every package |
| `pnpm test:harness` | Only the harness tests, through `node --test scripts/harness/` |

The harness (`scripts/harness/`) stays plain Node with no dependencies: its tests run with Node's built-in test runner, and `node --test scripts/harness/` works without `pnpm install`. ESLint checks its files as a development tool; the harness never imports anything from the workspace.

A task with no package defining it, such as `build` before the first package with a build step, runs nothing and succeeds. Packages are not created, and scripts are not added, only to give a task something to do.

## Backend module layout

Handwritten TypeScript backend modules use `src/modules/<name>/index.ts`. One module owns a cohesive responsibility, not necessarily a table or a database schema. Keep private helpers, drivers and colocated tests inside it. The agreed phase 2 placement is:

```text
apps/api/src/
  app.ts, server.ts                 # composition/startup adapters
  middleware/                      # HTTP authentication, limits, errors
  cli/api-keys.ts                   # maintenance adapter using services
  modules/profile/index.ts          # profile HTTP entry
  modules/media/index.ts            # media HTTP entry
packages/services/src/
  index.ts                          # explicit package exports
  modules/profile/index.ts          # profile/CV/domain operations
  modules/media/index.ts            # upload/attachment lifecycle
  modules/storage/index.ts          # driver-independent file operations
  modules/storage/drivers/          # private local and Bunny implementations
  modules/api-keys/index.ts          # generation, verification, revocation
packages/db/src/
  index.ts                          # explicit persistence exports
  modules/profile/index.ts          # persistence operations
  modules/profile/schema.ts         # private schema/repositories
  modules/profile/repositories/
  modules/api-keys/index.ts
  modules/api-keys/schema.ts
packages/contracts/src/
  index.ts                          # explicit contract exports
  errors.ts
  modules/profile/index.ts
  modules/media/index.ts
packages/api-client/src/
  index.ts
  generated/                        # generated code, not handwritten modules
```

SQL migrations stay in `packages/db/migrations/`, fictional seed data in `packages/db/seed/demo/`, and tests beside the behaviour they exercise. App startup/configuration, middleware and CLI adapters stay outside domain modules. The source entry convention is fixed; internal filenames evolve as real functionality arrives. No folders above need to be scaffolded before their phase.

| Caller | Allowed import surface |
| --- | --- |
| A private file inside its own module | Other private files of that same module |
| Another module or app/package composition code | That module's explicit `index.ts` entry |
| Another package | Declared package exports, initially the package-root entry |
| Framework/tooling running within its own package | A narrowly documented internal access needed by the tool; never a runtime client bypass |

Do not import another module's private file by a relative path or alias, reach into another package's source tree, or use an undeclared package subpath. Do not create cycles between modules. An entry exports selected operations and types, never an automatic `export *` of all internals. Package entry files re-export module entries deliberately. Shared transport contracts belong in contracts; a private backend helper type does not become a client contract merely to expose it.

Apply the information-hiding principles to all code, but do not force this TypeScript backend layout onto Next.js framework routes, UI primitives, generated clients, the plain Node harness or the future Python service. Their native placement stays intact; their relevant app/package maps describe their interfaces.

Each backend app/package `AGENTS.md` must map actual module paths to public entries, responsibilities, dependencies and relevant tests. See [code standards](code-standards.md#deep-modules) for the rationale and [architecture](architecture.md#module-responsibilities-and-composition) for ownership. The package dependency table below remains binding: a module entry never grants a client access to a forbidden package.

## Dependency rules

The API is the trust boundary: writes and authentication are enforced there and nowhere else. The import rules exist to keep it that way.

| Package or app | May import |
|---|---|
| `apps/web`, `apps/mcp-admin` | `api-client`, `contracts`, `ui` (web only), `config` — and they reach data only through the API over HTTP |
| `apps/llm-agent` (Python) | Nothing from the TypeScript packages; a client generated from the OpenAPI document — and it reaches data only through the API's public routes |
| `apps/api` | `services`, `contracts`, `config` |
| `packages/services` | `db`, `contracts`, `memory`, `config` |
| `packages/db` | nothing from this repository except `config` |
| `packages/contracts` | nothing from this repository except `config` |
| `packages/config` | nothing from this repository |

`packages/db` and `packages/services` must never be imported by `web` or `mcp-admin`, and `llm-agent` has no database access at all. A lint rule enforces this; do not disable it.

### The `sebela/import-boundaries` lint rule

`createConfig` from `@sebela/config/eslint` enables the rule as an error on every JavaScript and TypeScript file, so every package that lints itself with the shared configuration is checked by its normal `lint` task, and `pnpm lint` fails on a forbidden import. The rule lives in `packages/config/import-boundaries.js`; its behaviour tests and fixture workspace are described in `packages/config/AGENTS.md`.

- **Who imports.** The workspace root is the nearest folder above the file that contains `pnpm-workspace.yaml`. A file under `apps/<name>/` or `packages/<name>/` belongs to that member; other files (the harness, root configuration) are root files. A member's package name is `@sebela/<folder name>`.
- **The table.** A member imports another member only by package name and only if its row above allows it; importing itself is always allowed. Nothing imports an app. A member without a row (for example `api-client`, `ui` or `memory` before their phases) may import no workspace package: its row is added here and in the rule when the package is created. Root files are not in the table, but follow the entry-point and path rules.
- **Entry points.** An `@sebela/*` specifier must name a declared entry point: a subpath in the target's `exports`, or only the package root when the target has no `exports` or does not exist yet. Subpath patterns and `null` exclusions are honoured, so `@sebela/<name>/src/...` cannot bypass a package's public entry.
- **Paths.** A relative, absolute or `file:` path may not leave its member, reach into another member or go through `node_modules/@sebela/*`. A root file may not reach into a member by path.
- **Aliases.** A `#` subpath import is checked where the `imports` map of the importer's `package.json` sends it. In TypeScript files, any other bare specifier that the TypeScript program resolves to a workspace file (for example a `paths` alias) is checked as the path it resolves to. JavaScript files are linted without type information, so their aliases are not resolved.
- **Forms.** Static imports and re-exports (type-only ones too), dynamic `import()`, `require()`, TypeScript `import x = require()` and `typeof import()`. Specifiers that are not string literals cannot be checked. Third-party packages and Node.js built-ins are outside the rule.

The diagnostic names the specifier, the importing member and what it may import instead, for example: `'@sebela/db' imports @sebela/db, which apps/web may not import. apps/web may import @sebela/api-client, @sebela/contracts, @sebela/ui, @sebela/config (dependency table in docs/repository-structure.md)`. A change to the table above changes the `DEPENDENCIES` map in the rule and its tests in the same pull request.

## Ports and worktree isolation

Several agents work in parallel, each in its own git worktree. They share one Postgres container and nothing else.

| Service | Main checkout | Worktree with slot N |
|---|---|---|
| web | 3000 | 3000 + N × 10 |
| api | 3001 | 3001 + N × 10 |
| mcp-admin | 3002 | 3002 + N × 10 |
| llm-agent | 3003 | 3003 + N × 10 |
| postgres | 5440 (one shared container) | same port, separate database |

- The worktree setup script takes the lowest free slot, creates a database named after the branch, runs migrations and the demo seed, and writes the ports and database name to the worktree's `.env.local`.
- Running setup again for an existing worktree keeps its slot and preserves its `.env.local`, including local edits. A missing environment file is generated; an existing file or symbolic link is never overwritten.
- The cleanup script drops the database and frees the slot.
- In development each worktree also has its own folder in object storage, created and removed by the same scripts.
- Tests use their own temporary database, so they never touch the data an agent is looking at in the browser.
- **No port, host or database name is hard-coded** in application code, tests or scripts. Everything reads them from the environment. CI checks this.
- Postgres uses host port 5440 to stay clear of other local Postgres instances.
