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
- They are written with promptfoo. They call real models, so they run on demand and for changes to the AI parts (`mcp-admin`, `llm-agent`, `memory`), not on every pull request.
- Safety suites must pass completely. Other suites have a threshold set from the first baseline; it is never lowered to pass a run.
- They cover desired and forbidden behaviour: choosing the right tool, factual grounding, saying "I don't know", direct and indirect prompt injection, unsupported claims, source correctness, restraint with destructive tools.
- Evals live in the `evals/` folder of the app they belong to.

## Authentication as a property

There is one test that walks every route of the API and asserts: each write route and each private route returns 401 without a valid API key. A new route is covered automatically, so a write can never be left open by mistake. The chat conversation routes are the one named exception, with their own tests that they can touch only the caller's own conversation.

## Kinds of tests

| Kind | Tool | Scope |
|---|---|---|
| Unit | Vitest (TypeScript); chosen in phase 7 for Python | Pure logic |
| Integration | Vitest | API and services against a real Postgres — the database is not mocked |
| End to end and visual | Playwright | The website in a browser, including screenshots |
| Evals | promptfoo | MCP and AI behaviour, desired and forbidden |
| Tooling | Node's built-in test runner (`node --test`) | Plain JavaScript tooling: the harness; the lint rules of `@sebela/config` and the hard-coded configuration check (`scripts/checks/`), each against fixture files that must fail and fixture files that must pass |

## Configuration in tests

Tests follow the same rule as the code: no hard-coded port, local host address or database name (see [the hard-coded configuration check](repository-structure.md#the-hard-coded-configuration-check)). A test takes an expected port from `.env.example` or from the configuration it passes in, and leaves a fixed value to fixture files whose purpose is to hold it.

## Databases

- Each worktree has its own database (see `docs/repository-structure.md`).
- Tests use a separate temporary database, so they never touch the data an agent is looking at in the browser.
- Tests use small fictional fixtures, never the demo seed, so that editing demo content cannot break a test.

## CI

Lint, typecheck, tests and build must pass before a pull request can merge. A failing check is fixed, not disabled.

`.github/workflows/ci.yml` runs on every pull request and on pushes to `master` and `phase/**`:

| Job | Steps |
| --- | --- |
| `Harness tests` (required status check) | `node --test scripts/harness/` with plain Node and no installed dependencies |
| `Hard-coded configuration check` | `node --test scripts/checks/`, then `node scripts/checks/hardcoded-config.mjs`, with plain Node and no installed dependencies |
| `Lint, typecheck, test, build` | `pnpm install --frozen-lockfile`, then `pnpm lint` (including the hard-coded configuration check), `pnpm typecheck`, `pnpm test`, `pnpm build` |

All three use the Node.js version from `.nvmrc`; pnpm comes from `packageManager` in `package.json`. The root commands are the same ones contributors run locally (see [repository structure](repository-structure.md#root-commands)).
