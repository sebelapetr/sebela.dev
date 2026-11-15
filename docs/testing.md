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

## Databases

- Each worktree has its own database (see `docs/repository-structure.md`).
- Tests use a separate temporary database, so they never touch the data an agent is looking at in the browser.
- Tests use small fictional fixtures, never the demo seed, so that editing demo content cannot break a test.

## CI

Lint, typecheck, tests and build must pass before a pull request can merge. A failing check is fixed, not disabled.
