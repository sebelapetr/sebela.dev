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
│   ├── mcp-public/          Python, public read-only MCP transport [8]
│   └── ai-service/          Python / FastAPI, AI HTTP routes and runtime [7]
├── packages/
│   ├── config/              shared ESLint, TypeScript and Prettier configuration, incl. tsconfig.base.json [1]
│   ├── db/                  Drizzle schema, migrations, repositories [2]
│   │   └── seed/demo/       fictional person; the only seed in the repository
│   ├── services/            domain logic [2]
│   ├── contracts/           Zod schemas and types shared by API, web and MCP [2]
│   ├── api-client/          typed client generated from the OpenAPI document [2]
│   ├── ui/                  shared React components, design tokens [3]
│   ├── memory/              knowledge ingest, indexing and retrieval [9]
│   └── llm-agent/           Python library: pipelines, read tools, guardrails, evals [6]
│       ├── src/llm_agent/   importable package; responsibility folders per phase-6 PRD
│       ├── tests/          unit and integration tests
│       └── evals/          Promptfoo datasets and graders
├── harness/                 the agent harness — plain Node, no dependencies [0, hooks 1]; see harness/README.md
│   ├── run-phase.sh         starts the phase loop
│   ├── run-phase.mjs        the loop: one issue per run, usage-limit waits, retry labels
│   ├── worktree.mjs         worktree slots, ports, databases and database roles
│   ├── mcp.json             the only MCP servers of an unattended run
│   ├── hooks/               Claude Code hooks: the guard, formatting, worktree set-up
│   ├── git-hooks/           Git hooks installed by `pnpm install`
│   ├── lib/                 the pure rules behind them, with their tests
│   └── setup-github.sh      labels and branch protection, run once by the owner
├── scripts/
│   ├── checks/              repository checks: the hard-coded configuration check, the CI commit-message check, the API, website and production stack smoke checks, the production composition policy, the image-content check, the pinned-actions check, whether an event may start paid model evals and whether a change runs the MCP Admin ones, the change without its documentation that CI and the release plan compare, the test coverage summary and whether a push runs the full coverage run — plain Node, no dependencies [1, 2, 10]
│   └── release/             the release decisions: affected services, images to build and reuse; the deployment input, version, release notes and changelog; the production smoke check and the simulated deployment, with fixtures [10]
├── docs/                    architecture, design, workflow, decisions [1, grows]
├── .plan/                   PRDs and issue overviews, one folder per phase; merged phases in .plan/done/
├── .claude/
│   ├── skills/              grill-me, to-prd, to-issues, later content skills
│   ├── rules/               short rules that point to the relevant docs; path-scoped ones load in their area [0, 1]
│   ├── agents/              orchestrator, backend-, frontend- and ai-developer, reviewer, docs-keeper, steward, retrospective
│   └── settings.json        hooks and permissions
├── .github/
│   ├── workflows/           CI, the image release and the deployment [1, 10], the OpenSSF Scorecard, the coverage site on GitHub Pages
│   ├── CODEOWNERS           the owner as code owner of everything (review requested, not required)
│   ├── dependabot.yml       dependency updates: GitHub Actions and the images' pnpm monthly, the npm workspace and base images weekly
│   ├── ISSUE_TEMPLATE/      issue forms (bug report, idea) and links to private security reporting and Discussions
│   └── pull_request_template.md  sections of a pull request description, with the roles
├── compose.yaml             base stack: postgres [1]; profile `api`: migrate, api [2]; profile `web`: web [3]; later mcp
├── infra/                   production definition, see infra/README.md [10]
│   ├── production/          Compose production overrides and the production example settings
│   ├── nginx/               reference configuration of the server's nginx site
│   ├── pnpm/                pnpm for the container images: manifest and npm lockfile, installed with `npm ci` [10]
│   └── scripts/             server scripts: deploy.sh, the deployment and rollback run as the deploy user's forced SSH command
├── turbo.json               task pipeline [1]
├── pnpm-workspace.yaml      workspace packages, tool version catalog [1]
├── pnpm-lock.yaml           committed lockfile [1]
├── package.json             root commands, Node.js and pnpm versions [1]
├── .nvmrc                   Node.js major version [1]
├── eslint.config.js         lints root files: the harness, the repository checks and root configuration [1]
├── prettier.config.js       re-exports the shared Prettier configuration [1]
├── .prettierignore          generated files Prettier leaves alone [1]
├── .gitattributes           line endings, binary files and the generated API clients marked `linguist-generated` [0]
├── .dockerignore            allowlist of the image build context: manifests, apps, packages, `infra/pnpm`; of the seeds only the demo seed [2, 10]
├── .env.example             every setting with a comment and an example value; placeholders only [1]
├── .env.secrets.example     the owner's secrets for paid outside services, as placeholders; the real file stays in the main checkout [1]
├── AGENTS.md                rules for agents (each app and package also has its own)
├── CHANGELOG.md             every version's release notes, newest first; written by the release workflow [10]
├── GLOSSARY.md              canonical domain terms
├── CONTRIBUTING.md          how the repository is built and how outside contributors can help
├── SECURITY.md              private vulnerability reporting, scope and safe harbour
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
- **Seeds:** the repository contains only the fictional demo seed. The owner's real data is loaded once from a private seed outside the repository, in the same format, through the same command: `pnpm --filter @sebela/api seed [folder]` (the demo without a folder), or in the container stack `docker compose --profile api run --rm --volume <absolute folder>:/seed:ro api node dist/cli/seed.js /seed`, which mounts the folder read-only (`pnpm stack:seed` loads the demo seed only; `apps/api/AGENTS.md`, "Container stack"). Images never contain personal content. Format, identity and rerun rules: [`packages/db/seed/README.md`](../packages/db/seed/README.md).
- **Language:** code, docs, `AGENTS.md`, README and PRDs are in English.
- **Agent instructions:** the root `AGENTS.md` holds repository-wide rules; every app and package has its own `AGENTS.md` with what is specific to it. There are no `CLAUDE.md` files: Claude Code reads `AGENTS.md` directly when no `CLAUDE.md` exists, and other coding agents read it too.

## Toolchain and workspace

| Tool                                                       | Version                  | Declared in                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                                                    | 26, the current LTS line | `.nvmrc` (`26`) and `engines.node` in `package.json` (`>=26.0.0 <27.0.0`). `engineStrict` in `pnpm-workspace.yaml` makes installation fail on another version. |
| pnpm                                                       | 12.21.0                  | `packageManager` in `package.json`. CI and the container images (`infra/pnpm`) install exactly this version.                                                   |
| Turborepo, ESLint, TypeScript, Prettier, typescript-eslint | Exact versions           | The `catalog` in `pnpm-workspace.yaml`; packages depend on them with `catalog:`.                                                                               |

- **Prerequisites:** Git, Node.js 26 and pnpm 12.21.0. Install that pnpm version directly (for example `npm install --global pnpm@12.21.0`): pnpm 10 cannot switch itself to the native pnpm 12 executable, so an older global pnpm fails instead of switching.
- **Upgrading pnpm** changes `packageManager` and `infra/pnpm` together: set the version in `infra/pnpm/package.json` and run `npm install --package-lock-only --ignore-scripts` in that folder (`infra/README.md`, pnpm in the images).
- **Installation is locked:** `pnpm install --frozen-lockfile` installs exactly what `pnpm-lock.yaml` records. Change dependencies with `pnpm add` / `pnpm remove` and commit the updated lockfile in the same change.
- **TypeScript stays on 6.0** while `typescript-eslint`, which needs the TypeScript compiler API, supports only `<6.1.0`. Move both together.
- **Workspace members:** `apps/*` and `packages/*`. Every member is a `@sebela/*` package with its own `AGENTS.md`. A package defines only the tasks it can meaningfully run.

### Root commands

Run from the repository root. Turborepo runs a task in every package that defines it, after the `build` of the packages it depends on, and caches the result.

| Command                          | What it runs                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | The locked installation, as in CI; its `prepare` script enables the [Git hooks](git-workflow.md#local-hooks)                                                                                                                                                                              |
| `pnpm lint`                      | `lint` of every package, plus ESLint over the root files (`lint:root`: the harness, the repository checks and root configuration) the [hard-coded configuration check](#the-hard-coded-configuration-check) (`check:config`) and the formatting check (`check:format`)                    |
| `pnpm typecheck`                 | `typecheck` of every package                                                                                                                                                                                                                                                              |
| `pnpm test`                      | `test` of every package, plus the harness tests (`test:harness`) and the tests of the repository checks (`test:checks`)                                                                                                                                                                   |
| `pnpm build`                     | `build` of every package                                                                                                                                                                                                                                                                  |
| `pnpm test:harness`              | Only the harness tests, through `node --test harness/`                                                                                                                                                                                                                                    |
| `pnpm check:config`              | Only the hard-coded configuration check, through `node scripts/checks/hardcoded-config.mjs`. It scans the whole repository on every run and is never cached.                                                                                                                              |
| `pnpm check:format`              | Only the formatting check, through `node scripts/checks/formatting.mjs`: Prettier in check mode over every tracked file, as the `pre-commit` hook formats it ([Git workflow](git-workflow.md#local-hooks)). It checks the whole repository on every run and is never cached.              |
| `pnpm test:e2e`                  | `test:e2e` of every package that has it, after its `build` and the API's: the website's browser tests against a real API on a temporary database (`apps/web/AGENTS.md`, Tests). Needs the running Postgres and Chromium; never cached. CI runs it in the job `Website end to end`         |
| `pnpm test:checks`               | Only the tests of the repository checks and the release decisions, through `node --test scripts/`                                                                                                                                                                                         |
| `pnpm ci:root`                   | The root tasks as CI runs them on every change: `lint:root`, `check:config`, `check:format`, `test:harness` and `test:checks`                                                                                                                                                             |
| `pnpm ci:affected`               | `lint`, `typecheck`, `test` and `build` of the [affected packages](#affected-packages) only, as CI runs them; locally set `TURBO_SCM_BASE` to the branch's base, for example `TURBO_SCM_BASE=origin/phase/01-foundation`                                                                  |
| `pnpm generate:api-client`       | Exports the API's OpenAPI document from its source (`openapi:export` of `@sebela/api`, no database, configuration or secrets) into `packages/api-client/src/generated/openapi.json` and regenerates the client types beside it; see `packages/api-client/AGENTS.md`                       |
| `pnpm check:api-client`          | The [generated-code drift check](#the-generated-api-client-drift-check): runs `generate:api-client` and fails when the committed `packages/api-client/src/generated/` differs from the result. CI runs it on every change                                                                 |
| `pnpm stack:up`                  | The [container API stack](#the-container-api-stack) of the main checkout: refuses to start without `API_HOST`, `API_PORT`, `WEB_HOST` and `WEB_PORT`, builds the API and website images, runs the migration service, starts the API and then the website and waits until both are healthy |
| `pnpm stack:seed`                | The seed command in a one-off API container (the demo seed without a folder); never part of a start                                                                                                                                                                                       |
| `pnpm stack:api-keys`            | The API key command in a one-off API container, for example `pnpm --silent stack:api-keys create <name>`                                                                                                                                                                                  |
| `pnpm stack:logs`                | Logs of the stack's services                                                                                                                                                                                                                                                              |
| `pnpm stack:down`                | Stops and removes the website, API and migration containers; the shared Postgres keeps running                                                                                                                                                                                            |
| `pnpm test:api-stack`            | The [API stack smoke check](testing.md#ci), `node scripts/checks/api-stack.e2e.mjs`; needs Docker and is not part of `pnpm test`                                                                                                                                                          |
| `pnpm test:web-stack`            | The [website stack smoke check](testing.md#ci), `node scripts/checks/web-stack.e2e.mjs`: two disposable complete stacks side by side, then the complete-stack browser tests of `apps/web`; needs Docker and Chromium and is not part of `pnpm test`                                       |
| `pnpm test:production-stack`     | The [production stack smoke check](testing.md#ci), `node scripts/checks/production-stack.e2e.mjs`: the images built, checked for forbidden files and started as the production composition with the demo seed; needs Docker and is not part of `pnpm test`                                |
| `pnpm run prepare`               | Only the Git hooks installer, through `node harness/git-hooks/install.mjs`; pnpm runs it itself when an installation installs something                                                                                                                                                   |

The harness (`harness/`), the repository checks (`scripts/checks/`) and the release decisions (`scripts/release/`) stay plain Node with no dependencies: their tests run with Node's built-in test runner, and `node --test harness/`, `node --test scripts/` and `node scripts/checks/hardcoded-config.mjs` work without `pnpm install`. ESLint checks their files as a development tool; they never import anything from the workspace. Two repository checks, MCP Admin's Compose policy (`compose-policy.test.mjs`) and the production composition policy (`production-stack.test.mjs`, rendering `compose.yaml` with `infra/production/compose.yaml`), also need the Docker CLI, which renders the files without contacting a daemon; they live here because they read root files only, which select no package. The CI commit-message check (`scripts/checks/commit-messages.mjs`) imports the rule of the `commit-msg` hook from `harness/lib/commit-message.mjs`, so the hook and CI apply one set of rules. Likewise `scripts/checks/without-documentation.mjs` imports `isDocumentation` from `harness/lib/documentation.mjs`, the rule the developer handoff hook applies, so the hook, CI and the release plan count the same files as documentation. The hooks of the harness still use the workspace's tools, Prettier, ESLint and Turborepo, but only as programs: they start the executables that `pnpm install` put into the checkout's `node_modules/.bin`, in that checkout (`harness/lib/workspace-tools.mjs`), and their tests use fake executables instead. The fixtures of the hard-coded configuration check (`scripts/checks/fixtures/`) are sample files in several languages and are excluded from root ESLint, as the import-boundaries fixtures are from the lint of `@sebela/config`.

A task with no package defining it, such as `build` before the first package with a build step, runs nothing and succeeds. Packages are not created, and scripts are not added, only to give a task something to do.

### The generated API client drift check

`scripts/checks/generated-drift.mjs <folder>... -- <command>` runs a generator and fails when the listed folders then differ from what is committed: a changed, added (untracked) or removed file, reported with `git status` and a diff summary, and a hint naming the command to regenerate with. A failing generator fails the check. Plain Node with no dependencies, like the other repository checks; its tests (`generated-drift.test.mjs`) use a disposable Git repository and a fake generator. `pnpm check:api-client` applies it to the API client, and the quality job of CI runs that on every change, not only when the API is affected. The decision and the alternatives: [0014](decisions/0014-generated-api-client.md).

### Affected packages

`turbo run … --affected` selects the packages changed between a comparison base (`TURBO_SCM_BASE`) and `HEAD`, together with every package that depends on them. Turborepo widens that selection itself:

- A change to `turbo.json` or a file of `globalDependencies` in `turbo.json` (`.nvmrc`, `pnpm-workspace.yaml`) selects every package. A change to the root `package.json` selects only the root package (`//`), whose tasks CI runs on every change; the release workflow treats it as a change to every image (`docs/release-workflow.md`, Images).
- A change to the lockfile selects the packages whose external dependencies changed.
- The root depends on `@sebela/config`, so a change to the shared configuration selects every package, its consumers included.
- A base Turborepo cannot resolve in the checkout — a new branch, a rewritten history, a shallow clone — selects every package.

Root files that belong to no package (the harness, the repository checks, docs) select no package; the root tasks cover them, and CI runs those on every change (`pnpm ci:root`). Documentation never selects a package, not even inside the package's folder: CI and the release plan give Turborepo the change without its documentation (`scripts/checks/without-documentation.mjs`; [CI](testing.md#ci), "Documentation selects no work"). Run by hand, `turbo query affected` still counts it. `pnpm exec turbo query affected --packages` lists the selection with the reason for each package.

## Backend module layout

Handwritten TypeScript backend modules use `src/modules/<name>/index.ts`. One module owns a cohesive responsibility, not necessarily a table or a database schema. Keep private helpers, drivers and colocated tests inside it. The delivered phase 2 placement is:

```text
apps/api/src/
  app.ts, server.ts                 # composition/startup adapters
  config.ts                         # validated runtime configuration
  routing.ts, openapi.ts            # route descriptions and the generated OpenAPI document
  middleware/                       # HTTP authentication, limits, errors
  cli/                              # maintenance adapters using services: api-keys, seed, clear-content, storage, media, knowledge, openapi
  modules/profile/index.ts          # profile HTTP entry
  modules/media/index.ts            # media HTTP entry
  modules/roadmap/index.ts          # roadmap HTTP entry
packages/services/src/
  index.ts                          # explicit package exports
  services.ts                       # composition of the backend services from validated configuration
  modules/profile/index.ts          # profile/CV/domain operations
  modules/media/index.ts            # upload/attachment lifecycle
  modules/roadmap/index.ts          # roadmap operations; private progress.ts derives progress on read
  modules/storage/index.ts          # driver-independent file operations
  modules/storage/private.ts        # private storage of knowledge originals: no address, never served
  modules/storage/drivers/          # private local and Bunny implementations
  modules/api-keys/index.ts         # generation, verification, revocation
  modules/seed/index.ts             # loading a seed folder through profile, roadmap and media
packages/db/src/
  index.ts                          # explicit persistence exports
  testing.ts                        # test support: temporary databases (`@sebela/db/testing`)
  cli/migrate.ts                    # the migration command
  modules/profile/index.ts          # persistence operations
  modules/profile/schema.ts         # private schema; private files, mostly one per entity, hold its SQL
  modules/api-keys/index.ts
  modules/api-keys/schema.ts
  modules/roadmap/index.ts          # roadmap persistence; private schema.ts in schema `ai_roadmap`
packages/contracts/src/
  index.ts                          # explicit contract exports
  errors.ts
  modules/profile/index.ts
  modules/media/index.ts
  modules/roadmap/index.ts
packages/api-client/src/
  index.ts                          # createApiClient and the contract's DTO types
  generated/                        # committed generated code: openapi.json and schema.ts
```

SQL migrations stay in `packages/db/migrations/`, fictional seed data in `packages/db/seed/demo/`, and tests beside the behaviour they exercise. App startup/configuration, middleware and CLI adapters stay outside domain modules. The source entry convention is fixed; internal filenames evolve as real functionality arrives. No folders above need to be scaffolded before their phase.

| Caller                                           | Allowed import surface                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| A private file inside its own module             | Other private files of that same module                                                 |
| Another module or app/package composition code   | That module's explicit `index.ts` entry                                                 |
| Another package                                  | Declared package exports, initially the package-root entry                              |
| Framework/tooling running within its own package | A narrowly documented internal access needed by the tool; never a runtime client bypass |

A module is the folder `src/modules/<name>/` of an app or package; every file below it, at any depth and including its tests, belongs to it. Its entry is `index.<ext>` directly in that folder; a deeper `index` file, such as `drivers/index.ts`, is private. Tooling access means a configuration file `*.config.<ext>` directly in the package folder, such as `packages/db/drizzle.config.ts` reading the private schema for migrations. No other file imports such a configuration, by path or through a declared package export, so it cannot forward the access to runtime code; another tooling configuration of the same package is the only exception.

Do not import another module's private file by a relative path or alias, reach into another package's source tree, or use an undeclared package subpath. Do not create cycles between modules. An entry exports selected operations and types, never an automatic `export *` of all internals. Package entry files re-export module entries deliberately. Shared transport contracts belong in contracts; a private backend helper type does not become a client contract merely to expose it.

Apply the information-hiding principles to all code, but do not force this TypeScript backend layout onto Next.js framework routes (`apps/web/src/app/`), UI primitives (`packages/ui`), generated clients, the plain Node harness or the future Python service. Their native placement stays intact; their relevant app/package maps describe their interfaces. The website's own code beside its routes follows the [web module layout](#web-module-layout).

Each backend app/package `AGENTS.md` must map actual module paths to public entries, responsibilities, dependencies and relevant tests. See [code standards](code-standards.md#deep-modules) for the rationale and [architecture](architecture.md#module-responsibilities-and-composition) for ownership. The package dependency table below remains binding: a module entry never grants a client access to a forbidden package.

## Web module layout

The website (`apps/web`) keeps Next's file-based routing in `src/app/` and puts everything else into modules, with the same entry convention and the same lint rule as the backend ([decision 0017](decisions/0017-web-module-layout.md)):

```text
apps/web/src/
  app/                            # App Router routes only: page, layout, error, not-found, route files
    experience/page.tsx           # thin: metadata, notFound(), the request; renders a module's template
  config.ts                       # validated runtime configuration
  media-source.ts                 # where images may come from; next.config.ts and modules use it
  modules/
    <name>/index.ts               # the module's entry: selected exports only
    <name>/templates/             # the composition of a whole page
    <name>/components/            # the parts a template is built from
    <name>/data/                  # reading the API through @sebela/api-client; server-only
    <name>/types/                 # types several files of the module share
    <name>/hooks/                 # client hooks
    <name>/stores/                # client state
    _shared/index.ts              # what at least two modules or routes use
```

- **Routes stay thin.** A file in `src/app/` holds only what Next requires there: the route's metadata, `notFound()`, reading the request, and rendering a module's page template. It imports modules through their entries only. Page content, data reading and state live in modules.
- **Modules.** A module is `src/modules/<name>/`, named after the page or capability it serves (`homepage`, `experience`, `services`, `cv`, `chat`, `roadmap`). Its entry is `index.ts` or `index.tsx` directly in that folder; a deeper `index` file, such as `templates/index.tsx`, is private. Everything in [Backend module layout](#backend-module-layout) about entries, private files, selected exports and cycles applies, and the `sebela/import-boundaries` rule enforces it here exactly as there.
- **Folders inside a module.** The names above are the vocabulary: `templates/`, `components/`, `data/`, `types/`, `hooks/`, `stores/`. A folder is created when it has content, never scaffolded empty, and a module with nothing but a template and two components has only those two folders. Tests stay beside the behaviour they exercise.
- **`data/`, not `services/`.** Code that reads the API lives in `data/`. "Service" is a domain term ([`GLOSSARY.md`](../GLOSSARY.md)) with its own page and module, and `@sebela/services` is a package the website may not import.
- **`_shared`.** An ordinary module with one entry, for what is specific to this website and used by at least two modules or routes, such as the footer and the site's own addresses. It imports no other module. Code moves there when a second user appears, not before. Tokens, fonts and UI primitives stay in `packages/ui`.
- **Server and client.** An entry from which client components import values must not import server-only code, directly or through what it re-exports; client components may always import its types. `_shared`'s entry stays importable from client components. Reading that several pages share can live in a module of its own whose entry is server-only (today `profile`).
- **Module map.** `apps/web/AGENTS.md` maps every module to its entry, responsibility, dependencies and tests.

## Dependency rules

The API is the trust boundary: content writes and content authentication are enforced there. FastAPI separately authenticates internal generation and limits AI execution. The import rules exist to keep it that way.

| Package or app                | May import                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `apps/web`, `apps/mcp-admin`  | `api-client`, `contracts`, `ui` (web only), `config` — and they reach data only through the API over HTTP            |
| `apps/ai-service` (Python)    | `packages/llm-agent`; reaches content only through public API routes using generated Python contracts/client         |
| `apps/mcp-public` (Python)    | `packages/llm-agent` public capability contracts; reaches FastAPI over HTTP, never imports another app               |
| `packages/llm-agent` (Python) | Python integrations and generated content API client/models; no TypeScript packages or database drivers              |
| `apps/api`                    | `services`, `contracts`, `config`; `api-client` only in test files (`*.test.<ext>`), for its consumer contract tests |
| `packages/services`           | `db`, `contracts`, `memory`, `config`                                                                                |
| `packages/db`                 | nothing from this repository except `config`                                                                         |
| `packages/contracts`          | nothing from this repository except `config`                                                                         |
| `packages/memory`             | `contracts`, `config`; never `db` — `packages/db` implements its ports and `services` composes it                    |
| `packages/api-client`         | nothing from this repository except `config`; generated from the API's OpenAPI document, never its source            |
| `packages/ui`                 | nothing from this repository except `config`; design tokens, fonts and React components with no data access          |
| `packages/config`             | nothing from this repository                                                                                         |

`packages/db` and `packages/services` must never be imported by `web` or `mcp-admin`, and both Python apps and `packages/llm-agent` have no database access at all. A lint rule enforces this; do not disable it.

### The `sebela/import-boundaries` lint rule

`createConfig` from `@sebela/config/eslint` enables the rule as an error on every JavaScript and TypeScript file, so every package that lints itself with the shared configuration is checked by its normal `lint` task, and `pnpm lint` and CI fail on a forbidden import. The rule lives in `packages/config/import-boundaries.js` with private helpers beside it; its behaviour tests and fixture workspaces are described in `packages/config/AGENTS.md`. It needs no dependency beyond ESLint and TypeScript, which the shared configuration already uses.

- **Who imports.** The workspace root is the nearest folder above the file that contains `pnpm-workspace.yaml`. A file under `apps/<name>/` or `packages/<name>/` belongs to that member; other files (the harness, root configuration) are root files. A member's package name is `@sebela/<folder name>`.
- **The table.** A member imports another member only by package name and only if its row above allows it; importing itself is always allowed. Nothing imports an app. A member without a row (for example a new package before its row is added) may import no workspace package: its row is added here and in the rule when the package is created. Root files are not in the table, but follow the entry-point, path and private-module-file rules.
- **Entry points.** An `@sebela/*` specifier must name a declared entry point: a subpath in the target's `exports`, or only the package root when the target has no `exports` or does not exist yet. Subpath patterns and `null` exclusions are honoured, so `@sebela/<name>/src/...` cannot bypass a package's public entry.
- **Paths.** A relative, absolute or `file:` path may not leave its member, reach into another member or go through `node_modules/@sebela/*`. A root file may not reach into a member by path.
- **Aliases.** A `#` subpath import is checked where the `imports` map of the importer's `package.json` sends it. In TypeScript files, any other bare specifier that the TypeScript program resolves to a workspace file (for example a `paths` alias) is checked as the path it resolves to. JavaScript files are linted without type information, so their aliases are not resolved.
- **Forms.** Static imports and re-exports (type-only ones too), dynamic `import()`, `require()`, TypeScript `import x = require()` and `typeof import()`. Specifiers that are not string literals cannot be checked. Third-party packages and Node.js built-ins are outside the rule.
- **Private module files.** Once the checks above pass, the [backend module layout](#backend-module-layout) is checked inside the member; the website's modules ([web module layout](#web-module-layout)) are checked the same way. A file outside a module, whether another module, composition code, a CLI adapter, the package entry or a test, imports only the module's entry. Files of the module import each other freely. The tooling configurations described there are the only exception, and only for their own package; any other file that imports one of them, including through a declared package export, is rejected. Relative paths, `#` subpath imports and `paths` aliases are resolved first. A declared package export that leads to a private module file is rejected wherever it is imported, root files included, because it would turn a private file into a public entry.
- **Module cycles.** No import may close a cycle between the modules of a member. The rule reads the member's source files from disk and treats each module as one unit, including its private files and tests, and every other file as a unit of its own. The cycle may pass through files outside the modules, such as the package entry or the package's own name. The same forms and aliases count, type-only imports and `typeof import()` included. Every import of the cycle is reported where it is written, with the cycle as module folders, for example `src/modules/media -> src/modules/storage -> src/modules/media`. Cycles between members cannot arise, because the dependency table is acyclic. Cycles that pass through no module, for example between two startup files, are not checked.

**Limits.** The rule checks import syntax, not design. Information hiding, a cohesive interface, documented guarantees, and selected exports instead of a barrel of every internal file are left to the reviewer (see [code standards](code-standards.md#enforcement-and-review)). JavaScript files have no type information, so their `paths` aliases are resolved neither for their own imports nor in the cycle search. Specifiers computed at run time are invisible.

Each diagnostic names the specifier and what is allowed instead, for example: `'@sebela/db' imports @sebela/db, which apps/web may not import. apps/web may import @sebela/api-client, @sebela/contracts, @sebela/ui, @sebela/config (dependency table in docs/repository-structure.md)`. A package allowed only in test files is listed in the rule's `TEST_DEPENDENCIES` map; elsewhere in the member it is rejected with a message saying so. A change to the table above changes the `DEPENDENCIES` and `TEST_DEPENDENCIES` maps in the rule and its tests in the same pull request.

## Ports and worktree isolation

Several agents work in parallel, each in its own git worktree. They share one Postgres container and nothing else.

| Service        | Main checkout               | Worktree with slot N                  |
| -------------- | --------------------------- | ------------------------------------- |
| web            | 3000                        | 3000 + N × 10                         |
| api            | 3001                        | 3001 + N × 10                         |
| mcp-admin      | 3002                        | 3002 + N × 10                         |
| ai-service [7] | 3003                        | 3003 + N × 10                         |
| mcp-public [8] | 3004                        | 3004 + N × 10                         |
| postgres       | 5440 (one shared container) | same port, separate database and role |

- The AI-service port is a phase-7 target; the public-MCP port is phase 8. Each owning phase updates worktree environment generation, task wrappers and Compose before its app runs. Phase 6 introduces the Python library/toolchain only. MCP Admin and private content writes are internal/SSH-tunnel only; these development port assignments do not authorize public exposure.
- Knowledge originals use a separately configured private Bunny zone or local root from phase 9, with development/worktree isolation and no public-URL mapping. Do not reuse the public media handler or treat a `private/` prefix as access control.
- The worktree setup script (`node harness/worktree.mjs create`, also run by the `WorktreeCreate` hook) takes the lowest free slot, creates the worktree's own database and database role in the shared Postgres, or reuses them, and then writes the ports, the database name, the role's credentials and the worktree's storage folder to the worktree's `.env.local`. Then it runs the [backend setup](#worktree-backend-setup) in the worktree: dependencies, pending migrations, the storage folder and the demo seed of an empty profile. It takes the base ports (the main checkout column above) from the environment, as described in [Configuration and environment](#configuration-and-environment). If the requested issue branch `<type>/<n>-<slug>` does not exist but another branch of the same issue `n` does, locally or on `origin`, the script continues that branch and its worktree instead of starting a second one, and says so; an interrupted issue keeps its work.
- Running setup again for an existing worktree keeps its slot, its database and its role's password and preserves its `.env.local`, including local edits. A missing environment file is generated, and the role gets a new password that only the new file holds, so regenerating the file restores working credentials. An existing file or symbolic link is never overwritten, so a worktree whose `.env.local` predates its database or role gets `DATABASE_NAME`, `DATABASE_USER` and `DATABASE_PASSWORD` only after that file is deleted and setup runs again.
- The cleanup script (`node harness/worktree.mjs remove`, also run by the `WorktreeRemove` hook) removes the worktree's storage folder, drops the worktree's database, every other database its role owns and then the role, removes the worktree and frees the slot.
- In development each worktree also has its own storage folder, `<STORAGE_ENVIRONMENT>/<STORAGE_WORKTREE>/`, on local disk or in the development Bunny zone, created and removed by the same scripts ([Worktree backend setup](#worktree-backend-setup)).
- Tests use their own temporary database, so they never touch the data an agent is looking at in the browser.
- **No port, host or database name is hard-coded** in application code, tests or scripts. Everything reads them from the environment. [The hard-coded configuration check](#the-hard-coded-configuration-check) enforces this locally and in CI.
- Postgres uses host port 5440 to stay clear of other local Postgres instances.

### The shared Postgres

`compose.yaml` in the repository root defines five services: `postgres`, started by default, `migrate` and `api` in the profile `api`, `web` in the profile `web` and `mcp-admin` in the profile `mcp-admin` ([The container API stack](#the-container-api-stack)), on three networks: `database` (Postgres, the migration, the API), `content` (the API, the website) and `admin` (the API, MCP Admin). `postgres` is PostgreSQL 18 with the pgvector extension available from the start (image `pgvector/pgvector`, pinned to an exact tag and the digest of its multi-architecture index, so a re-pushed tag cannot change what runs; tag and digest are upgraded together), data in the named volume `postgres-data`, and a health check that reports healthy once the server answers a query over TCP on its initial database and pgvector can be created. Its top-level `name: sebela` makes every checkout address the same stack and volume, so the owner starts it once, from the main checkout:

```bash
cp .env.example .env               # once; set your own POSTGRES_PASSWORD before the first start
docker compose up --detach --wait  # returns when the service is healthy
```

Compose takes every setting from the process environment or from the `.env` file next to `compose.yaml`; a missing Postgres setting stops it with a message naming the variable. Compose interpolates every service, also those of an inactive profile, so the API services require none of their settings: Postgres-only commands (`up`, `down`, `exec postgres`) need the Postgres settings only. The published address and port are `POSTGRES_HOST` and `POSTGRES_PORT`. `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` (the main checkout's database) take effect when the volume is first initialised. `docker compose down` stops the service and keeps the data; `docker compose down --volumes` deletes it.

### The container API stack

The profile `api` of `compose.yaml` adds two services built from `apps/api/Dockerfile`; a plain `docker compose up` (CI, the harness) still starts Postgres only. `migrate` applies the committed migrations once Postgres is healthy and exits; `api` starts only when `migrate` has exited successfully, publishes `API_PORT` on `API_HOST` and keeps local media in the named volume `api-media`. The containers reach Postgres by its service name on the container port, and the API listens on its own container port, both declared in `compose.yaml`; every other setting comes from the same environment as the host API, and the database settings are the checkout's own `DATABASE_*`. A missing one reaches the containers empty and the API's or the migration's own validation stops them with its name; `pnpm stack:up` checks the host-side `API_HOST` and `API_PORT` before it starts, because empty ones would publish the API on every interface on a random port. The profile `web` adds the website, built from `apps/web/Dockerfile` without any setting; it starts once the API is healthy, reads the API by its service name inside the network, publishes `WEB_PORT` on `WEB_HOST`, and reads stored files at the API's internal file route (`WEB_MEDIA_READ_BASE_URL`) while pages name them only by the website's own `/media/<file>`. With `API_WEB_INVALIDATION_SECRET` set, the API notifies the website container. `pnpm stack:up` also checks `WEB_HOST` and `WEB_PORT`. The profile `mcp-admin` adds MCP Admin, built from `apps/mcp-admin/Dockerfile`; it starts once the API is healthy, reads the API by its service name on the `admin` network, which it shares with the API only, publishes `MCP_ADMIN_PORT` on `MCP_ADMIN_HOST` (loopback) and receives only its `MCP_ADMIN_*` settings, no key and no database setting (`apps/mcp-admin/AGENTS.md`, "Container"). The stack belongs to the main checkout (`pnpm stack:up`, see [Root commands](#root-commands)); worktrees run the API and the website on the host on their own ports. Behaviour, commands and shutdown: `apps/api/AGENTS.md`, "Container stack", and `apps/web/AGENTS.md`, "Container".

### Worktree databases

- **Name.** `databaseName` in `harness/lib/slots.mjs` derives the name from the worktree's folder name, so a branch and its folder give the same database: `wt_`, the folder name in lower case with every run of other characters turned into `_`, shortened so the whole name fits Postgres's 63-byte limit, then `_` and ten hexadecimal characters of a SHA-256 hash of the folder name. `feat/12-profile-api` becomes `wt_feat_12_profile_api_<hash>`. The hash keeps folders apart that would otherwise normalise alike (`a.b`, `a-b`, `A-B`) and long names that share a beginning. The prefix keeps worktree databases apart from the main checkout's.
- **Role and credentials.** Each worktree also has its own Postgres role, named like its database by the same `databaseName`, so the API and its tests connect from their own process without the superuser password. The role is `LOGIN`, `CREATEDB` (tests create their own temporary databases), `NOSUPERUSER` and `NOCREATEROLE`, and owns the worktree's database; `CONNECT` on that database is revoked from `PUBLIC`, so a worktree's role cannot open another worktree's database. Its password is 256 cryptographically random bits (`harness/lib/credentials.mjs`), written only to the worktree's `.env.local` as `DATABASE_USER` and `DATABASE_PASSWORD`, next to `DATABASE_NAME`, which only the file's owner may read. Postgres receives a SCRAM-SHA-256 verifier computed by the script instead of the password, so the password never appears in a statement, on a command line, in output, in an error or in the server log. Setup re-asserts the role's attributes, its ownership of the database and the revoked `CONNECT` every time, which also brings a database created before worktrees had roles under its role. pgvector is not a trusted extension, so the role cannot create it: setup creates `vector` as the superuser in the worktree's database and in `template1`, from which the temporary test databases are copied, and migrations use `CREATE EXTENSION IF NOT EXISTS vector`. Code connects with `POSTGRES_HOST`, `POSTGRES_PORT`, `DATABASE_NAME`, `DATABASE_USER` and `DATABASE_PASSWORD` from the environment. The superuser password stays in the main checkout's `.env` and never reaches a worktree.
- **Ownership.** The setup script records the owning worktree in the comment of its database and of its role. Setup reuses a database or role only when it already belongs to the same worktree, and cleanup drops only such a database or role. Worktree roles may create databases and comment on their own, so a database's comment counts only while the database is owned by the worktree's role or by the superuser the scripts connect as (a database from before worktrees had roles); a database of a worktree's name owned by any other role — say, one another worktree planted — is refused. A database or role with a worktree's name that the scripts did not create for it is refused, never used or dropped; setup checks both before it creates either. The scripts create nothing but names of the derived form. Cleanup drops the worktree's database, then every other database its role owns — temporary test databases, whatever their name — and then the role, in that order; it refuses before dropping anything when the role owns the main checkout's database or a database recorded for another worktree.
- **How the scripts reach Postgres.** The harness stays plain Node without a database driver: `harness/lib/databases.mjs` runs `psql` inside the running service through `docker compose exec`, as the service's superuser connected to `POSTGRES_DB`. Compose runs with the process environment, falling back to `.env.example` for settings that are not set. Without a running service, setup and cleanup fail and say how to start it.
- **Failures.** Setup ensures the role and the database before it writes the environment file, and holds the slot lock meanwhile. When an environment file appears while setup runs, it is kept and setup fails, as the role's new password is not in it; delete it and run `create` again. When they cannot be created or reused, whatever this run created — a role, a database, a worktree, a branch, a slot — is removed again and the script fails; an existing worktree keeps its slot and its `.env.local`. So a `.env.local` names a database and credentials only once they exist. Cleanup refuses uncommitted work as before (unless `--force`) and drops the databases and the role before it removes anything else: when a drop fails, the worktree, its environment file and its slot stay as they were and the removal can be repeated. Repeating a completed removal changes nothing. Databases are dropped with `WITH (FORCE)`, which ends connections a development server or a test run of that worktree still holds.
- **Manual cleanup.** Removal needs the running service, because dropping the databases and the role comes first; start it, then repeat `remove`. A database or role the scripts refuse, one whose comment names no or another worktree, is never dropped by them: the owner checks it and drops it by hand with `psql`.
- **End-to-end run.** `node harness/worktree-databases.e2e.mjs` checks the whole lifecycle against real Postgres: healthy startup; two worktrees whose roles have the documented attributes, each connecting over the network with its own credentials to its own database and refused on the other's, or with a wrong password; creating and dropping a temporary database; pgvector usable by the role in its own database and in a temporary one; reuse with unchanged credentials; a new working password when `.env.local` is regenerated; no password in the script's output or the server log; refusal of a foreign role, a foreign database and a database another worktree's role planted with a forged comment; failure without a running service; removal of one worktree, including a temporary database its role left behind, without losing the other; and cleanup that leaves no worktree role or database. It needs Docker, starts its own disposable Compose project from `compose.yaml` on a free host port, works with worktrees of a temporary repository and removes all of it at the end. It is not part of `pnpm test`: run it on demand, and CI runs it on every pull request and push in the job `Worktree database lifecycle`. Each run uses its own Compose project name and a free port, so it can be repeated, also next to the shared stack.

### Worktree backend setup

- **Stages.** After the database, the role and `.env.local` exist, `create` runs four stages in the worktree, each a package script of the worktree's own checkout started through `pnpm` (`harness/lib/backend.mjs`), so the harness imports no application code: `pnpm install --frozen-lockfile --prefer-offline`; `pnpm --filter @sebela/db db:migrate`; `pnpm --silent --filter @sebela/api storage prepare <worktree>`; `pnpm --silent --filter @sebela/api seed --if-empty`. A stage whose script the checkout does not have yet is skipped with a notice. The stages get the caller's environment without the worktree's own settings (every variable `.env.example` names and the `WORKTREE_`, `WEB_`, `API_`, `MCP_`, `LLM_AGENT_`, `POSTGRES_`, `DATABASE_`, `STORAGE_` and `MEDIA_` prefixes), so they read the worktree's `.env.local`; only `POSTGRES_HOST` and `POSTGRES_PORT`, where the shared Postgres listens, pass through. Their output goes to standard error, so the last line of `create` stays the worktree path.
- **Rerun.** Setup runs again for an existing worktree: install and migrations apply only what is missing or pending, the storage folder the worktree holds is reused, and the seed is skipped when the profile already holds any content — a person, any profile record, any media or any roadmap area — so content an agent edited is never overwritten. The owner refreshes a worktree's content explicitly with `pnpm --silent --filter @sebela/api seed`, which loads the demo seed over the existing records ([`packages/db/seed/README.md`](../packages/db/seed/README.md)).
- **Storage folder.** `storageWorktreeName` in `harness/lib/slots.mjs` derives `STORAGE_WORKTREE` from the folder name like `databaseName`: the folder name in lower case with every run of other characters turned into `-`, shortened to fit 63 characters, then `-` and ten hexadecimal characters of the same hash, so no two worktrees share a folder. A generated `.env.local` also sets `STORAGE_PUBLIC_BASE_URL` to the worktree's own API (`http://<API_HOST>:<its API_PORT>/v1/media/files`) and `WEB_API_BASE_URL`, the API the website reads, to the same API's origin (`http://<API_HOST>:<its API_PORT>`), `WEB_SITE_ORIGIN`, the website's canonical origin, to its own website (`http://<WEB_HOST>:<its WEB_PORT>`), and `WEB_MEDIA_BASE_URL`, the only folder the website's image optimizer fetches from, to its own media folder (`http://<API_HOST>:<its API_PORT>/v1/media/files/<STORAGE_ENVIRONMENT>/<STORAGE_WORKTREE>`), `API_WEB_INVALIDATION_URL`, where its API sends signed invalidation notifications, to its own website's receiver (`http://<WEB_HOST>:<its WEB_PORT>/internal/invalidation`), and `API_WEB_INVALIDATION_SECRET` and `WEB_INVALIDATION_SECRET` to one newly generated random secret of its own, so a content write through its API refreshes its own website only, and `MCP_ADMIN_API_URL`, the API its MCP Admin calls, to its own API's origin (`http://<API_HOST>:<its API_PORT>`). Local storage stays below the worktree's own `STORAGE_LOCAL_ROOT`; with `STORAGE_DRIVER=bunny-s3` the development zone is shared and the folder keeps worktrees apart. `storage prepare` writes an owner marker, `.owner`, naming the worktree into the folder, or reuses a folder whose marker names it; `storage remove` deletes the folder's files, the marker last, only when the marker names the worktree. Both refuse, without touching storage, a configuration without `STORAGE_WORKTREE`, `STORAGE_ENVIRONMENT=production`, a folder another worktree's marker claims, files without a marker and, on local disk, a folder or marker that is a symbolic link.
- **Failures.** A failing stage stops setup with its name; the worktree, its `.env.local`, its database and its slot are kept, and running `create` again retries. An existing `.env.local` without `STORAGE_WORKTREE` (from before this setup) is never changed: setup stops before the storage stage and says to delete the file and run `create` again, which generates it with a new password. `remove` removes the storage folder after the uncommitted-work check and before the databases; when that fails, nothing else is removed and the removal can be repeated. It needs the worktree's installed tools; without them it refuses unless `--force`, which leaves the storage folder behind with a notice. A worktree folder that is already gone, or one without its `.env.local`, has no settings to find its storage folder by: `remove` goes on and prints a notice naming the folder. With the default `STORAGE_LOCAL_ROOT` inside the worktree its files went with the worktree; with `STORAGE_DRIVER=bunny-s3` or a root outside the worktree the folder is left behind and has to be removed by hand. Each stage has a 30-minute limit, so a hanging stage fails setup instead of blocking it.
- **End-to-end run.** `node harness/worktree-backend.e2e.mjs` clones this checkout's committed `HEAD` into a temporary folder and, against a disposable Compose project as above, creates two worktrees, checks that each is migrated and seeded, has its own marked storage folder, serves its profile through its own API on a free port and accepts an upload with a key from its own `api-keys` command, that setup again keeps an edit and skips the seed, and that removing one keeps the other's data and files and leaves the clone unchanged. It needs Docker and pnpm, no cloud keys. CI runs it in the job `Worktree backend setup`.

### Configuration and environment

- Code reads ports, hosts and database names from the process environment and validates them where it starts. It carries no copy of them, not even as a fallback for an unset variable: a missing setting is an error that names the variable.
- `.env.example` lists every variable with a comment. Its values are the documented examples — the port scheme of the main checkout above, the Postgres address and port, user and database names — and placeholders such as the Postgres password and `DATABASE_PASSWORD`; it never holds credentials or real data. A fixed value that must exist is declared there, or in a declaration such as `compose.yaml`, not in executable code. Installation needs no settings.
- `.env.secrets.example` lists the owner's secrets for paid outside services (today `ANTHROPIC_API_KEY` for the model evals) with a comment and an empty value. The owner copies it to `.env.secrets` in the main checkout only; no worktree gets a copy, agents may not read it, and the commands that need a secret load it through `node harness/with-secrets.mjs -- <command>` (`docs/permissions.md`, Environment files). Together the two examples list every variable.
- The main checkout uses the values of `.env.example`; its `.env`, created from that file with the owner's own passwords, is where Compose reads them. The main checkout sets its own `DATABASE_USER` and `DATABASE_PASSWORD` there. Each worktree gets its own generated `.env.local` with `WORKTREE_SLOT`, the ports of its slot, `DATABASE_NAME`, its own database, and `DATABASE_USER` and `DATABASE_PASSWORD`, its own role (see [Worktree databases](#worktree-databases)), `STORAGE_WORKTREE` and `STORAGE_PUBLIC_BASE_URL`, its own storage folder and media address (see [Worktree backend setup](#worktree-backend-setup)), `WEB_API_BASE_URL` and `WEB_SITE_ORIGIN`, so its website reads its own API and builds its canonical addresses on its own origin, and the website invalidation address and its secret pair, so its API's notifications reach its own website. Nothing from the owner's `.env` or `.env.secrets` is copied into a worktree. The Postgres address and port are shared by every worktree; the superuser and its password are not given to them.
- `node harness/worktree.mjs create` (and the `WorktreeCreate` hook, which uses it) takes the base ports `WEB_PORT`, `API_PORT`, `MCP_ADMIN_PORT` and `LLM_AGENT_PORT` from the process environment and, for each one that is not set there, from the `.env.example` of the checkout the script belongs to. Each must be a whole number that leaves room for slot 9. A missing or invalid base port stops the script before it creates a worktree, allocates a slot or writes a file. The Compose settings it needs to reach the database service come from the same two places.
- The backend commands (`dev`, `start`, `api-keys`, `seed` and `storage` of `apps/api`, `db:migrate` of `packages/db`) and the backend tests read the process environment first, then the checkout's `.env.local`, `.env` and `.env.example`; a variable already set wins. The API's own settings (`API_HOST`, `API_PORT`, `API_BODY_LIMIT_BYTES`, `API_TRUSTED_PROXIES`, the `API_RATE_LIMIT_*` budgets and the website invalidation destination and secret `API_WEB_INVALIDATION_URL` and `API_WEB_INVALIDATION_SECRET`) are documented in `.env.example` and `apps/api/AGENTS.md`; the documented body limit (`196608` bytes) fits the longest case study written in multi-byte characters.
- The website's commands (`dev`, `start` and `test:e2e` of `apps/web`) read the environment in the same order; its settings (`WEB_HOST`, `WEB_PORT`, `WEB_API_BASE_URL`, `WEB_SITE_ORIGIN`, `WEB_MEDIA_BASE_URL`, `WEB_MEDIA_READ_BASE_URL` (where the server reads stored files when not at the media base, set by `compose.yaml` for the container), `WEB_INVALIDATION_SECRET`, the server-only secret that verifies the API's invalidation notifications, `WEB_CONTENT_REVALIDATE_SECONDS`, the content cache's fallback revalidation interval, and the optional `WEB_ANALYTICS_SCRIPT_URL` and `WEB_ANALYTICS_WEBSITE_ID`, the analytics tracker's address and website identifier, both empty for no analytics) are documented in `.env.example` and `apps/web/AGENTS.md`. Its build needs none of them.
- MCP Admin's tests read the environment in the same order, and the server reads the process environment (`apps/mcp-admin/AGENTS.md`, Commands); its settings (`MCP_ADMIN_HOST`, `MCP_ADMIN_PORT`, `MCP_ADMIN_API_URL`, the allowed hosts and origins, trusted proxies, body, time, concurrency and rate limits) are documented in `.env.example` and `apps/mcp-admin/AGENTS.md`. It has no API key setting: every caller presents its own.
- Turborepo runs tasks in strict environment mode: a task sees only the variables `turbo.json` declares. The `test` and `test:e2e` tasks pass the database settings through (`passThroughEnv`; `test:e2e` also `CI`); every other setting they need comes from the checkout's environment files, which the commands read themselves. A new variable a task needs is declared there in the same change.
- Tests take expected ports from `.env.example` too, so the documented example stays the only place the base ports are written down.

### The hard-coded configuration check

`node scripts/checks/hardcoded-config.mjs` fails when executable code hard-codes a port, a local host address or a database name. It runs in `pnpm lint` (as `check:config`), in the quality job of CI, and on its own in the plain-Node CI job `Hard-coded configuration check`.

**Scope.** Without arguments it checks every file of the repository that Git lists — tracked, or untracked and not ignored — and that is executable:

| Files                                                                                                                                                        | Checked as                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `*.js`, `*.mjs`, `*.cjs`, `*.jsx`, `*.ts`, `*.tsx`, `*.mts`, `*.cts`; files without an extension whose interpreter line names `node`, `deno`, `bun` or `tsx` | JavaScript and TypeScript |
| `*.py`; files without an extension whose interpreter line names `python`                                                                                     | Python                    |
| `*.sh`, `*.bash`; files without an extension whose interpreter line names `sh`, `bash`, `dash` or `zsh`                                                      | Shell                     |
| The `scripts` of every `package.json`                                                                                                                        | Shell commands            |

This covers application code, tests and scripts alike, including the harness and the check itself. Given paths, it checks only those files and directories; its tests use this for the fixtures.

**Findings.** Each is reported as `file:line:column rule: message`, pointing at the hard-coded value. Any finding makes the command exit with 1; a check that cannot run (for example outside a Git repository) exits with 2. A clean run names the number of executable files it read.

"Assigned" below means `=` (also after a type annotation, such as `port: number =` or `WORKER_PORT: int =`, and for a parameter default), `:` in an object literal, `??=` and `||=`; in the shell only `=`.

| Rule                  | What it finds                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`                | A port-named variable or key (`API_PORT`, `PGPORT`, `port`, `api_port`, `apiPort`) assigned a number of two to five digits; an explicit port in a URL (`scheme://host:<number>`); `.listen(<number>)`; `--port <number>` and `-p <number>`. Port `0`, "any free port", is allowed.                                                                                  |
| `local-host`          | `localhost`, `127.x.x.x`, `0.0.0.0` and a quoted or bracketed `::1`.                                                                                                                                                                                                                                                                                                |
| `database-name`       | A database-named variable or key (`DATABASE_NAME`, `POSTGRES_DB`, `PGDATABASE`, `database`, `dbName`) assigned a string literal; the database of a connection URL (`postgres://…/<name>`); `CREATE`, `DROP` or `ALTER DATABASE <name>`; in shell commands also `createdb` and `dropdb <name>` and `psql`, `pg_dump` or `pg_restore` with `-d <name>` or `--dbname`. |
| `environment-default` | A port, host, database, URL or DSN variable read from the environment with a literal fallback: `process.env.API_PORT ?? …`, `env["API_URL"] \                                                                                                                                                                                                                       | \   | …`, `os.getenv("API_HOST", …)`(also with`default=`), `os.environ.get(…, …)`, `os.environ.setdefault("DB_HOST", …)`, `${WEB_PORT:-…}`. The value belongs in `.env.example`; the code fails when the variable is not set. |

A value built from the environment passes: `Number(process.env.API_PORT)`, `` `http://${host}:${port}` ``, `os.environ["DATABASE_URL"]`, `createdb "$DATABASE_NAME"`, `next dev --port $WEB_PORT`.

**What is not executable configuration.** These narrow rules are the only exceptions; there is no inline suppression and no excluded runtime or harness directory.

1. Documentation and declarations are not read: Markdown, HTML, YAML (Compose files, workflows), JSON other than the `scripts` of a `package.json`, `.env.example` and Dockerfiles.
2. A comment that starts a line is documentation: in JavaScript and TypeScript a `//` comment and a `/* … */` block that starts a line, up to where it closes; in Python and shell a line starting with `#`. Code after a block comment that closes on the same line is checked, and so is a comment after code.
3. The deliberate negative fixtures of the check, exactly the folder `scripts/checks/fixtures/hardcoded-config/`, are left out of the repository scan. Its tests check them explicitly: `rejected/` must fail at the listed locations, `accepted/` must pass.
4. Files that Git ignores (`node_modules/`, `.worktrees/`, build output, environment files) are not part of the repository.

**Limits.** The check recognises the common spellings above, not every way to write a value: a comparison (`port === …`), a value assembled from parts or a positional argument passes unnoticed. Review still looks for hard-coded environment values. A new spelling the check should catch starts with a failing fixture in `scripts/checks/fixtures/hardcoded-config/rejected/` and a case in `scripts/checks/hardcoded-config.test.mjs`.
