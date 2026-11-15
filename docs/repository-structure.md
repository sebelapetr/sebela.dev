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
│   ├── config/              shared ESLint, TypeScript and Prettier configuration [1]
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
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
├── AGENTS.md                rules for agents (each app and package also has its own)
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

## Dependency rules

The API is the trust boundary: writes and authentication are enforced there and nowhere else. The import rules exist to keep it that way.

| Package or app | May import |
|---|---|
| `apps/web`, `apps/mcp-admin` | `api-client`, `contracts`, `ui` (web only), `config` — and they reach data only through the API over HTTP |
| `apps/llm-agent` (Python) | Nothing from the TypeScript packages; a client generated from the OpenAPI document — and it reaches data only through the API's public routes |
| `apps/api` | `services`, `contracts`, `config` |
| `packages/services` | `db`, `contracts`, `memory` |
| `packages/db` | nothing from this repository except `config` |
| `packages/contracts` | nothing from this repository except `config` |

`packages/db` and `packages/services` must never be imported by `web` or `mcp-admin`, and `llm-agent` has no database access at all. A lint rule enforces this; do not disable it.

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
