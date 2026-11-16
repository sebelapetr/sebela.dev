# 0013 — The harness lives in a top-level `harness/` folder

Status: accepted
Date: 2026-11-16

## Decision

- The agent harness moves from `scripts/harness/` to `harness/`, and the loop's entry from `scripts/run-phase.sh` to `harness/run-phase.sh`. Its contents and behaviour do not change.
- `harness/README.md` introduces it and points to `docs/agents.md` and `docs/permissions.md`.
- `scripts/` remains for repository checks and other scripts, such as `scripts/checks/`.

## Why

The harness is a first-class part of how this repository is built, and the repository is part of the portfolio: a reader should see it at the top level rather than under a generic `scripts/` folder. `scripts/` was no longer the harness alone — phase 1 added the repository checks — so the harness gets its own name instead of the folder being renamed.

Records 0007 and earlier name the old paths; they are not rewritten.
