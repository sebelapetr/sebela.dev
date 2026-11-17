# Phase 1 — Foundation

|            |                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Status     | Approved                                                                                                                |
| Date       | 2026-11-15                                                                                                              |
| Parent     | `.plan/00-overview/prd.md`                                                                                              |
| Depends on | The harness (`.plan/00-overview/harness-prd.md`) and a passed trial (`.plan/00-trial/prd.md`)                           |
| Result     | A monorepo with its toolchain, guard rails and CI. The first phase processed by the loop. No application behaviour yet. |

## Problem Statement

The rules, the agents and the loop exist, but there is no codebase for them to work in. Before any feature is built, the monorepo, its shared tooling and the automated checks that keep agents inside the architecture must be in place — otherwise the first feature issue would have to invent them.

## Solution

A foundation phase that delivers the working environment and nothing else: the Turborepo monorepo with shared configuration, the checks that enforce the architecture, a Compose stack with Postgres and a database per worktree, the full CI pipeline, and the hooks that depend on the toolchain.

After this phase, an issue from phase 2 can be handed to the loop.

## User Stories

1. As the owner, I want one command to install the repository and start its infrastructure, so that a new machine is ready in minutes.
2. As the owner, I want every pull request gated by lint, typecheck, tests and build, so that phase branches and the main branch always work.
3. As the owner, I want commit messages checked against Conventional Commits, so that the history stays readable.
4. As the orchestrator, I want each worktree to get its own database automatically, so that parallel agents never share data.
5. As the orchestrator, I want removing a worktree to drop its database, so that nothing is left behind.
6. As a developer agent, I want changed files formatted automatically, so that I do not spend effort on formatting.
7. As a developer agent, I want typecheck and lint to run on what I changed when I finish, so that I hand over clean work.
8. As a developer agent, I want import boundaries enforced by lint, so that I learn immediately when I take a forbidden shortcut.
9. As a developer agent, I want a check that catches hard-coded ports and hosts, so that my work runs in any worktree.
10. As a developer agent, I want rules that load automatically when I work in a given part of the codebase, so that I do not have to remember which document applies.
11. As a contributor, I want a README that explains what the project is and how to run it, so that I can start without asking.
12. As a contributor, I want the licence split between code and content stated in the README, so that I know what I may reuse.

## Implementation Decisions

### Monorepo

- Turborepo with pnpm workspaces on the current Node LTS; TypeScript in strict mode.
- Package scope `@sebela/*`.
- One package is created in this phase: shared configuration (lint, TypeScript, formatting). Apps and the other packages arrive with their phases; their folders are not created empty.
- Pipeline tasks: lint, typecheck, test, build. CI runs them only for what a change affects.

### Infrastructure

- A Compose file in the repository root with one service: Postgres on host port 5440, with a named volume and a health check. The image includes the pgvector extension from the start, so the database does not have to be changed when retrieval arrives in phase 9.
- An example environment file lists every variable with a comment. Real environment files are never committed.

### Per-worktree databases

- The worktree setup script from the harness is extended: it derives a database name from the branch name, creates the database and writes its name to the worktree's local environment file. The cleanup script drops it.
- Running migrations and the demo seed is added in phase 2, when they exist.
- Name derivation is part of the existing pure slot module and is tested there.

### Guard rails in code

- **Import boundaries:** a lint rule encodes the dependency table from `docs/repository-structure.md`. It is in place before the packages it protects exist.
- **No hard-coded endpoints:** a check fails when a port, localhost address or database name appears in application code, tests or scripts instead of being read from the environment.

### Continuous integration

- GitHub Actions on every pull request, on phase branches and on the main branch: install, lint, typecheck, test, build, the two guard-rail checks. It replaces the minimal workflow from the harness.
- Commit messages are linted against Conventional Commits.
- Before each commit, staged files are formatted and linted locally. Typecheck and tests run in CI only, to keep commits fast.

### Hooks that need the toolchain

- After a file is edited: format it.
- When a developer agent finishes: run typecheck and lint for the packages it changed and report failures back to it.

### Rules

- Path-scoped rules are added for the areas that now exist, so that the relevant documents load when an agent works there.
- Each app and package created from now on comes with its own `AGENTS.md`.

### README

What the project is, the architecture in one diagram, how to run it, how development is orchestrated, and the licence split (code under MIT; personal content © Petr Šebela). Sections about the assistant, MCP and retrieval are added by their phases.

## Testing Decisions

- A good test here checks behaviour through the public interface: given this branch name, the database name is that one; given this file, the lint rule reports this violation.
- **Tested, test-first:**
  - database name derivation, including long and unusual branch names;
  - the import-boundary rule — against fixture files that must fail and fixture files that must pass;
  - the hard-coded endpoint check — the same way.
- **Verified by running, not by unit tests:** the Compose stack starts and reports healthy; the setup and cleanup scripts create and remove a database end to end; CI fails on a deliberately broken commit; the two new hooks fire.
- **Prior art:** the Booky monorepo for Turborepo, lint and CI setup; the harness tests for the slot module.

## Out of Scope

- The loop, worktree slots, permissions, agent definitions and the documentation — delivered in phase 0.
- Any app or package with behaviour, including empty placeholders for them.
- Database schema, migrations and seeds (phase 2).
- Design system and UI tooling (phase 3).
- Production deployment, release pipelines, reverse proxy (phase 10).

## Further Notes

- The owner's global configuration already defines hooks (terminal status indicator) and auto mode; project settings add to them.
- Harness logic stays on plain Node and its built-in test runner; it is not migrated to the application toolchain.
