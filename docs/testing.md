# Testing

What is tested, in which order, and how.

## Principle

Test external behaviour, not implementation: an HTTP request and its response, a rendered page, a tool call and its result, a function's output for an input. A test that breaks when code is refactored without changing behaviour is a bad test.

The project exists to ship a good product. The rules below are strict where a mistake is costly and light where a human eye judges better than an assertion.

## Where test-first is mandatory

The test is written first and must fail without the implementation. The reviewer checks the order in the branch history.

- Security: authentication — every private route rejects a request without a valid API key, and every write is a private route
- API contracts
- Services and domain logic
- Bug fixes — first a test that reproduces the bug

## Test surfaces and the red–green–refactor cycle

An approved issue/PRD identifies the behaviour and the public operation to test. Record the relevant surface (HTTP request, service operation, persistence operation, pure transformation or rendered visitor journey), what it observes and the important failure cases. Existing approval covers those tests; an unattended agent does not ask the owner to approve the same surface again. Ask only if a material scope/domain decision is genuinely unresolved.

Work in small observable slices: write one behavioural test, run it and confirm failure for the missing behaviour, commit the red test, implement enough to pass, then rerun relevant checks. Refactor after green without changing behaviour, and keep the tests. An import error or broken fixture is not the intended red evidence. Expected values come from the requirement or independently worked examples, not the implementation formula repeated in the assertion.

Tests enter the module through the operation they exercise and assert results/errors/state visible through that contract. Do not mock the internal call graph or assert helper call counts/order. Nontrivial internal pure functions may have focused tests without becoming public exports solely for tests. Do not add tests that only restate configuration, generated files or trivial forwarding code. Required security/HTTP/validation/persistence behaviour still needs tests even if a handler delegates it.

Persistence integration tests use real Postgres and separate temporary databases. Controlled clocks/randomness and external provider fakes are appropriate at real external interfaces; they do not replace actual database integration. Test failure/rollback outcomes through the relevant persistence/service/HTTP contract; low-level integrity checks are valid in tests whose subject is persistence integrity. Local-storage tests may use disposable real files; normal CI never needs Bunny credentials.

Use the project-local [tdd reference](../.claude/skills/tdd/SKILL.md); [codebase-design](../.claude/skills/codebase-design/SKILL.md) helps if the interface itself is unclear. Follow the UI and MCP/AI verification policies below; these references do not extend test-first requirements to typography or replace model evals with mocks.

## Where visual evidence is the standard

Layout, typography and responsive polish are accepted on:

- the acceptance criteria of the issue,
- Playwright checks for behaviour (navigation, interaction, no horizontal scroll),
- screenshots at **360, 768 and 1280 px**, in **light and dark** mode,
- a visual review by the reviewer and the owner.

A test written before the markup is not required here.

## Evals-driven development

MCP tools and AI features are developed evals-first.

- Evals are written before the implementation and state a pass threshold.
- They are written with promptfoo. They call real models, so they run on demand and for changes to the AI parts (`mcp-admin`, `ai-service`, `mcp-public`, the `llm-agent` package and `memory`), not on every pull request.
- Safety suites must pass completely. Other suites have a threshold set from the first baseline; it is never lowered to pass a run.
- They cover desired and forbidden behaviour: choosing the right tool, factual grounding, saying "I don't know", direct and indirect prompt injection, unsupported claims, source correctness, restraint with destructive tools.
- Evals live in `apps/mcp-admin/evals/`, `packages/llm-agent/evals/` and `packages/memory/evals/`. Agent-package evals include FastAPI/MCP integration and all three stages.
- Code graders check deterministic properties; model graders use versioned rubrics calibrated against human labels. Human review covers ambiguous cases, grader disagreements and a sample of automatically passed answers. Record human scores and release decisions.
- Measure attack success from outcomes and executed tool calls, plus legitimate-question false positives, latency and cost. Passing a finite safety suite is a release gate, not proof of absolute security.
- Use fictional adversarial fixtures. Real visitor/owner data never enters committed regression datasets.

## Authentication as a property

There is one test that walks every route of the API and asserts: each write route and each private route returns 401 without a valid API key. A new route is covered automatically, so a write can never be left open by mistake. The chat conversation routes are the one named exception, with their own tests that they can touch only the caller's own conversation.

## Kinds of tests

| Kind                  | Tool                                             | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                  | Vitest (TypeScript); pytest (Python)             | Pure logic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Integration           | Vitest; pytest for Python HTTP/runtime contracts | API/services use real Postgres; Python uses a test API and fake model providers                                                                                                                                                                                                                                                                                                                                                                                                            |
| End to end and visual | Playwright                                       | The website in a browser, including screenshots                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Evals                 | promptfoo                                        | MCP and AI behaviour, desired and forbidden                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Tooling               | Node's built-in test runner (`node --test`)      | Plain JavaScript tooling: the harness, including its Git and Claude Code hooks, which run against disposable Git repositories with fake Prettier, ESLint and Turborepo executables at their command-line interface; the lint rules of `@sebela/config`, the hard-coded configuration check and the CI commit-message check (`scripts/checks/`), the last against disposable Git repositories and GitHub events, each against fixture files that must fail and fixture files that must pass |

## Configuration in tests

Tests follow the same rule as the code: no hard-coded port, local host address or database name (see [the hard-coded configuration check](repository-structure.md#the-hard-coded-configuration-check)). A test takes an expected port from `.env.example` or from the configuration it passes in, and leaves a fixed value to fixture files whose purpose is to hold it.

## Databases

- Each worktree has its own database and database role, and its tests connect with that role's credentials (see `docs/repository-structure.md`). The harness tests check the worktree lifecycle through a fake at the harness's database interface, so `node --test harness/` needs no Docker; `node harness/worktree-databases.e2e.mjs` checks the same lifecycle against a real, disposable Postgres from `compose.yaml`, on demand and in the CI job `Worktree database lifecycle` (see [Worktree databases](repository-structure.md#worktree-databases)).
- Tests use a separate temporary database, so they never touch the data an agent is looking at in the browser.
- Tests use small fictional fixtures, never the demo seed, so that editing demo content cannot break a test.

## Local checks

Checks run at three points before CI, each lighter than the next:

| When                            | What runs                                                                                                        | Where it is described                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| An agent edits or writes a file | Prettier on that file                                                                                            | [Permissions](permissions.md#formatting-after-an-edit) |
| A commit is made                | Prettier and ESLint on the staged files; the commit message against Conventional Commits. No typecheck, no tests | [Git workflow](git-workflow.md#local-hooks)            |
| A developer agent hands off     | Lint and typecheck of the changed packages, their dependents and the root, in its worktree. No tests             | [Permissions](permissions.md#handoff-checks)           |

The developer still runs the tests and the build for what it changed before it finishes; CI runs everything.

## CI

Lint, typecheck, tests and build must pass before a pull request can merge. A failing check is fixed, not disabled. The orchestrator merges an issue pull request only when every check reported on it is green (`gh pr checks --watch`).

Two workflows run on every pull request and on pushes to `master` and `phase/**`. Every job runs on every event: none is skipped by a path filter, so a status is never left waiting or reported as skipped.

`.github/workflows/ci.yml`:

| Job                                     | Steps                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Harness tests` (required status check) | `node --test harness/` with plain Node and no installed dependencies                                                                                                                                                                                                                                                                                                             |
| `Hard-coded configuration check`        | `node --test scripts/checks/`, then `node scripts/checks/hardcoded-config.mjs`, with plain Node and no installed dependencies                                                                                                                                                                                                                                                    |
| `Lint, typecheck, test, build`          | `pnpm install --frozen-lockfile`; `turbo query affected --packages`, which logs the selection and its reasons; `pnpm ci:root` — root ESLint, the hard-coded configuration check, the harness tests and the tests of the repository checks, on every run; `pnpm ci:affected` — `lint` (with the import-boundaries rule), `typecheck`, `test` and `build` of the affected packages |
| `Worktree database lifecycle`           | `node harness/worktree-databases.e2e.mjs`: the worktree database lifecycle against a real, disposable Postgres from `compose.yaml`, with plain Node and Docker                                                                                                                                                                                                                   |

`.github/workflows/commit-messages.yml`:

| Job               | Steps                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Commit messages` | `node scripts/checks/commit-messages.mjs`: the commits of the pull request or push and the title of an issue pull request (see [What CI validates](git-workflow.md#what-ci-validates)); it runs again when a title is edited |

All jobs use the Node.js version from `.nvmrc`; pnpm comes from `packageManager` in `package.json`. The root commands are the same ones contributors run locally (see [repository structure](repository-structure.md#root-commands)).

**Affected packages.** The quality job checks out the full history and compares `HEAD` with the pull request's base commit, or on a push with the commit before the push (`TURBO_SCM_BASE`). Which packages that selects, and when every package is selected, is described in [Affected packages](repository-structure.md#affected-packages). A change to the shared configuration selects its consumers; a change to the harness, the checks or other root files selects no package, but the root tasks run on every change regardless.

**CI checks the head of the branch, not each commit.** A test-first issue branch has a commit with a failing test before the implementation; only the tip of the branch must pass.

**Evidence that a failure fails the pipeline** is recorded on the pull request that set the pipeline up (#75, issue #20): the run of a deliberately broken commit and the run of the commit that reverted it are linked there. No model evals, release pipeline or deployment runs in CI in phase 1.
