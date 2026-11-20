# Phase 0 — Harness

|        |                                                                                          |
| ------ | ---------------------------------------------------------------------------------------- |
| Status | Done — tried in `.plan/done/00-trial/result.md`                                          |
| Date   | 2026-11-15                                                                               |
| Parent | `.plan/00-overview/prd.md`                                                               |
| Built  | By hand, in an interactive session on `phase/00-overview` — the loop cannot build itself |
| Result | A phase can be started with one command and processed unattended up to a pull request    |

## Problem Statement

Every phase from 1 on is meant to be processed by agents without the owner present. The machinery that makes this possible has to exist, and has to be trusted, before the first real phase starts. It cannot be delivered by the process it enables.

## Solution

Build the harness by hand as the last part of phase 0, then prove it in a trial phase (`.plan/done/00-trial/prd.md`) before any real code is written.

The harness is: the phase loop, worktree isolation, agent definitions, hooks, permissions, GitHub labels and branch rules, and a minimal CI. The written rules it relies on — `AGENTS.md`, `docs/`, `.claude/rules/`, the agents — already exist.

## User Stories

1. As the owner, I want to start a phase with one command and come back to a single pull request, so that I am not needed between issues.
2. As the owner, I want the loop to wait and resume by itself when the usage limit is reached, so that a phase finishes without me watching.
3. As the owner, I want an issue that keeps failing to be labelled and skipped, so that the loop does not burn usage on it.
4. As the owner, I want the loop to stop after several consecutive failures, so that a broken setup does not run all night.
5. As the owner, I want a log of every run, so that I can see afterwards what happened.
6. As the owner, I want to stop the loop at any moment and start it again later, so that I never lose progress.
7. As the owner, I want no agent ever to merge into or push to the main branch, so that I stay the only gate to it.
8. As the owner, I want agents unable to read secrets or my private notes, so that nothing leaks into a public repository.
9. As the orchestrator, I want a worktree for an issue created with one command, with its own ports, so that parallel work never collides.
10. As the orchestrator, I want to remove a worktree with one command that frees everything it took.
11. As the orchestrator, I want CI to report on issue pull requests against a phase branch, so that I know when I may merge.
12. As a developer agent, I want to be stopped if I try to edit app or package code in the main checkout, so that I do not bypass the flow by mistake.

## Implementation Decisions

### The loop

- A script takes a phase folder name and, optionally, a base branch (`master` unless given), and repeatedly starts Claude Code non-interactively with the orchestrator agent. One iteration handles one issue and starts with a clean context. The phase branch is cut from the base branch and the phase pull request targets it.
- The script holds no state. Everything is read from GitHub each time: issue labels, pull requests, the phase branch.
- Outcomes of a run and what follows:

| Outcome                                                                           | Next                                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Issue merged into the phase branch                                                | Next iteration                                                                                  |
| Usage limit reached                                                               | Wait ten minutes, retry the same step                                                           |
| Usage limit reached during an issue (reported `interrupted`, cause `usage_limit`) | Wait the same way and continue the same issue, without a label                                  |
| A model safeguard stopped the run or an agent (cause `safeguard`)                 | Retry once at once, without a label; stop and alert the owner when it repeats on the same issue |
| The environment cannot run the work (cause `environment`)                         | Stop at once and alert the owner with the cause, without a label                                |
| Issue failed, first time                                                          | Label `agent-retry`; next iteration; the issue may be retried                                   |
| Issue failed, second time                                                         | Label `agent-failed`, skip it                                                                   |
| Several consecutive failed runs                                                   | Stop                                                                                            |
| No ready issue left                                                               | The orchestrator opens the phase pull request; the loop ends                                    |

- This decision table is a small pure module with no shell, network or agent in it, so it is testable without running anything.
- A usage limit is recognised from the run's JSON result (an API error with status 429 or 529, or a limit message) or from its error output. Established from the documentation; it is confirmed the first time a real limit occurs, and the raw output of every run is logged for that purpose.
- Sequential in this version: one issue at a time.
- Each run writes a log outside git.

### Worktree isolation

- A setup script takes the lowest free slot and writes the ports of that slot to the worktree's local environment file; a cleanup script frees the slot and removes the worktree. Scheme: `docs/repository-structure.md`.
- The database part (create and drop a database per worktree) is added in phase 1, when the Compose stack exists; migrations and seeding in phase 2.
- Slot allocation and port computation are a small pure module, tested in isolation.
- The scripts are wired to Claude Code's worktree creation and removal hooks.

### Tooling for the harness itself

There is no monorepo yet. Harness logic is written for plain Node with no dependencies and tested with Node's built-in test runner. It stays that way; it does not depend on the application tooling it supports.

### Permissions and hooks

As described in `docs/permissions.md`. In an unattended run nothing can be confirmed. The loop runs in auto mode: the allow list runs without review, the auto-mode classifier judges everything else, and the deny list and the guard hook refuse what must never happen. (The first trial run used accept-edits mode; it refused every development command not on the allow list, including a developer's `cd`.)

- Hooks delivered now: block edits to app and package code in the main checkout; worktree setup and cleanup; reminder to run the docs-keeper after an issue is merged.
- Hooks that need the application toolchain (formatting on edit, typecheck and lint when a developer finishes) are delivered in phase 1.
- Project settings add to the owner's global settings and must not replace the global hooks.

### GitHub

- Labels: `phase:<folder>` for each phase, `afk`, `hitl`, `ready-for-agent`, `agent-retry`, `agent-failed`, `trial`.
- The main branch is protected: pull request required, CI green, merged by the owner only.
- Phase branches accept squash merges of issue pull requests from the orchestrator.

### Minimal CI

One workflow on pull requests and on phase branches that runs the tests present in the repository. In phase 0 that is the harness tests; phase 1 replaces it with the full pipeline.

## Testing Decisions

- **Tested first, in isolation:** the loop's decision table; slot allocation, freeing and port computation including the case when slots run out.
- **Verified by running:** each denied action is actually refused; each hook fires; the cleanup leaves nothing behind.
- **Proven end to end by the trial phase.** The harness is not considered done until `00-trial` has passed; only then is phase 0 merged into the main branch.

## Out of Scope

- Parallel processing of issues — planned in `parallel-harness-prd.md`.
- Running the loop from CI or on a server.
- Sandboxing beyond worktrees and permissions.
- Anything belonging to the application toolchain (phase 1).
