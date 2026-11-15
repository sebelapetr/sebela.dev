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
│   ├── mcp-public/          Python, public read-only MCP transport [7]
│   └── ai-service/          Python / FastAPI, AI HTTP routes and runtime [7]
├── packages/
│   ├── config/              shared ESLint, TypeScript and Prettier configuration [1]
│   ├── db/                  Drizzle schema, migrations, repositories [2]
│   │   └── seed/demo/       fictional person; the only seed in the repository
│   ├── services/            domain logic [2]
│   ├── contracts/           Zod schemas and types shared by API, web and MCP [2]
│   ├── api-client/          typed client generated from the OpenAPI document [2]
│   ├── ui/                  shared React components, design tokens [3]
│   ├── memory/              indexing and retrieval [6]
│   └── llm-agent/           Python library: pipelines, read tools, guardrails, evals [7]
│       ├── src/llm_agent/   importable package; responsibility folders per phase-7 PRD
│       ├── tests/          unit and integration tests
│       └── evals/          Promptfoo datasets and graders
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
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
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
- **Tests** sit next to the code they test. End-to-end tests live in `apps/web/e2e/`; evals live in `apps/mcp-admin/evals/`, `packages/llm-agent/evals/` and `packages/memory/evals/`. Python uses package-local `tests/unit/` and `tests/integration/`.
- **Two languages:** `apps/ai-service`, `apps/mcp-public` and `packages/llm-agent` use Python with their own dependency toolchain and participate in monorepo tasks/CI. Other apps/packages use TypeScript.
- **Seeds:** the repository contains only the fictional demo seed. The owner's real data is loaded once from a private seed outside the repository, in the same format, through the same command.
- **Language:** code, docs, `AGENTS.md`, README and PRDs are in English.
- **Agent instructions:** the root `AGENTS.md` holds repository-wide rules; every app and package has its own `AGENTS.md` with what is specific to it. There are no `CLAUDE.md` files: Claude Code reads `AGENTS.md` directly when no `CLAUDE.md` exists, and other coding agents read it too.

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

The API is the trust boundary: content writes and content authentication are enforced there. FastAPI separately authenticates internal generation and limits AI execution. The import rules exist to keep it that way.

| Package or app | May import |
|---|---|
| `apps/web`, `apps/mcp-admin` | `api-client`, `contracts`, `ui` (web only), `config` — and they reach data only through the API over HTTP |
| `apps/ai-service` (Python) | `packages/llm-agent`; reaches content only through public API routes using generated Python contracts/client |
| `apps/mcp-public` (Python) | `packages/llm-agent` public capability contracts; reaches FastAPI over HTTP, never imports another app |
| `packages/llm-agent` (Python) | Python integrations and generated content API client/models; no TypeScript packages or database drivers |
| `apps/api` | `services`, `contracts`, `config` |
| `packages/services` | `db`, `contracts`, `memory` |
| `packages/db` | nothing from this repository except `config` |
| `packages/contracts` | nothing from this repository except `config` |

`packages/db` and `packages/services` must never be imported by `web` or `mcp-admin`, and both Python apps and `packages/llm-agent` have no database access at all. A lint rule enforces this; do not disable it.

## Ports and worktree isolation

Several agents work in parallel, each in its own git worktree. They share one Postgres container and nothing else.

| Service | Main checkout | Worktree with slot N |
|---|---|---|
| web | 3000 | 3000 + N × 10 |
| api | 3001 | 3001 + N × 10 |
| mcp-admin | 3002 | 3002 + N × 10 |
| ai-service [7] | 3003 | 3003 + N × 10 |
| mcp-public [7] | 3004 | 3004 + N × 10 |
| postgres | 5440 (one shared container) | same port, separate database |

- The AI-service and public-MCP port assignments above are targets for phase 7; that phase updates worktree environment generation, task wrappers and Compose before these apps run.
- The worktree setup script takes the lowest free slot, creates a database named after the branch, runs migrations and the demo seed, and writes the ports and database name to the worktree's `.env.local`.
- Running setup again for an existing worktree keeps its slot and preserves its `.env.local`, including local edits. A missing environment file is generated; an existing file or symbolic link is never overwritten.
- The cleanup script drops the database and frees the slot.
- In development each worktree also has its own folder in object storage, created and removed by the same scripts.
- Tests use their own temporary database, so they never touch the data an agent is looking at in the browser.
- **No port, host or database name is hard-coded** in application code, tests or scripts. Everything reads them from the environment. CI checks this.
- Postgres uses host port 5440 to stay clear of other local Postgres instances.
