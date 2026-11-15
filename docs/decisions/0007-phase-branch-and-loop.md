# 0007 — Phase integration branch and an unattended loop

Status: accepted
Date: 2026-11-15

## Decision

Each phase has an integration branch `phase/<phase-folder>`. Issue pull requests target it and the orchestrator squash-merges them after the reviewer agent approves and CI is green. The owner reviews one pull request per phase, from the phase branch to `master`, merged with a merge commit. A script runs the orchestrator in a loop, one issue per iteration, waiting and retrying when the usage limit is reached.

## Why

The owner wants to review at the end of a phase, not between issues. Issues depend on each other, so finished work has to be available to the next issue without a merge into `master`. Keeping all state in GitHub makes the loop restartable at any point.

## Rejected

- **Stacked branches, one pull request per issue to `master`.** Each approval with a squash merge breaks the stack and forces a rebase of everything above it — fragile for an unattended run.
- **Loop over independent issues only.** Nothing changes in the rules, but the owner must approve and restart between dependency layers.
- **Agents never merge anything.** Safest, but incompatible with an unattended phase.
