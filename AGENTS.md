# AGENTS.md

Rules for every coding agent working in this repository. Read this file first, then the `AGENTS.md` of each app or package you touch.

## What this project is

The personal professional website of Petr Šebela (sebelapetr.cz): one site for clients and employers, built on one structured data model that also feeds the CV, the AI Engineering Roadmap, a chatbot and two MCP servers. The repository is open source and is itself part of the portfolio.

- Overview and phases: `.plan/00-overview/prd.md`
- The PRD of the phase you work in: `.plan/NN-<phase>/prd.md`

## Documentation is binding

`docs/` describes how this repository works. Follow it. If the code and a document disagree, fix one of them in the same pull request — never leave them apart.

| Topic | Document |
|---|---|
| Where things live, allowed imports, ports | `docs/repository-structure.md` |
| Layers, trust boundary, data flow | `docs/architecture.md` |
| Vocabulary, entities, access | `docs/domain-context.md` |
| Code conventions | `docs/code-standards.md` |
| What to test and how | `docs/testing.md` |
| Branches, commits, pull requests | `docs/git-workflow.md` |
| Agent roles and orchestration | `docs/agents.md` |
| What agents may and may not do | `docs/permissions.md` |
| Visual language | `docs/design.md` |
| Releases | `docs/release-workflow.md` |
| Why things are the way they are | `docs/decisions/` |

## Hard rules

1. **The API is the trust boundary.** Only `apps/api` reaches the database. `apps/web`, `apps/mcp-admin` and `apps/llm-agent` talk to the API over HTTP and never import `@sebela/db` or `@sebela/services`.
2. **Every write to content is an authenticated, private API route.** Public routes are read-only, with one named exception from phase 7: a visitor may create and continue their own chat conversation. The API key is used by server-side callers only and never reaches client-side code.
3. **No real personal data in the repository.** Only the fictional demo seed and fictional test fixtures. Never copy anything from `.context/` into tracked files. Everything stored in the database is public content — there is no private flag.
4. **Nothing is hard-coded about the environment.** Ports, hosts and database names come from environment variables. Each worktree has its own values.
5. **Work in a worktree.** App and package code is never edited in the main checkout.
6. **Only the owner merges into `master`.** Never push to `master`, never force-push a shared branch. The orchestrator — and no other agent — may squash-merge a reviewed issue pull request into its phase branch.
7. **Environment files:** agents may read and edit `.env.example` (placeholders only) and `.env.local` inside their assigned worktree. Run the session from that worktree. Other environment files, other worktrees and the main checkout's environment files are off limits. Production credentials never belong in a development worktree. Never commit environment files or copy their values into public output.
8. **Do not add a top-level folder, app or package** that is not in `docs/repository-structure.md` without the owner's approval.
9. **Do not weaken a check to make it pass.** No disabled lint rules, skipped tests or lowered thresholds without the owner's approval.

## Testing

- **Test-first is mandatory** for security, API contracts, services and domain logic, and bug fixes. The test is written first and must fail without the implementation.
- **UI layout, typography and responsive polish** are accepted on acceptance criteria, Playwright checks and screenshots at 360, 768 and 1280 px in light and dark mode. A test before the markup is not required.
- **MCP and AI features are evals-first.** Evals with a stated pass threshold are written before the implementation.

Details: `docs/testing.md`.

## Git

- One issue → one branch → one worktree → one pull request into the phase branch `phase/<phase-folder>`.
- One phase → one pull request into `master`, reviewed and merged by the owner.
- Commits follow Conventional Commits. One squashed commit per issue.
- The pull request description names who implemented, who reviewed and who approved.

Details: `docs/git-workflow.md`.

## Commands

| Task | Command |
|---|---|
| Create a worktree for a branch | `node scripts/harness/worktree.mjs create <branch> --base <ref>` (prints its path) |
| Remove it and free its slot | `node scripts/harness/worktree.mjs remove <branch> [--delete-branch]` |
| List worktree slots | `node scripts/harness/worktree.mjs list` |
| Run a phase unattended (owner only) | `scripts/run-phase.sh <phase-folder> [--base <branch>]` |
| Harness tests | `node --test scripts/harness/` |

## Language

Code, comments, docs, commit messages, pull requests and PRDs are written in English. The owner converses in Czech.

## When you are unsure

Stop and ask the orchestrator or the owner rather than guessing about scope, structure or anything that touches secrets or the owner's personal data.
