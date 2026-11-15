# Git workflow

The git history of this repository is public and part of the portfolio. It must read well.

## Flow

```
issue → branch → worktree → implementation → checks → review → issue pull request
      → orchestrator squash-merges into the phase branch
                                  ...all issues of the phase...
phase branch → phase pull request → owner approval → merge into master
```

One issue, one branch, one worktree, one pull request. One phase, one integration branch, one pull request to `master`.

## Branches

| Branch | Purpose | Who merges into it |
|---|---|---|
| `master` | The only long-lived branch | The owner only |
| `phase/<phase-folder>` | Integration branch of a phase, for example `phase/02-api-db` | The orchestrator, after review and green CI |
| `<type>/<issue-number>-<short-slug>` | One issue, for example `feat/12-profile-experience-api` | — |

- `<type>` is a Conventional Commits type: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.
- An issue branch is cut from the phase branch and its pull request targets the phase branch.
- Phase 0 (planning, docs, agent configuration and the harness) has no issues. It is done directly on `phase/00-overview` and reaches `master` through the same kind of phase pull request, after the trial has passed.
- The trial is the one phase whose base is not `master`: `phase/00-trial` is cut from `phase/00-overview`, and its phase pull request targets that branch and is closed without merging.
- Other work without an issue uses `<type>/<short-slug>`, for example `docs/fix-testing-guide`, and targets `master` through a pull request the owner merges.

### Why a phase branch

Issues of a phase depend on each other. The owner reviews at the end of a phase, not between issues, so finished work must be available to the next issue without waiting for a merge into `master`. The phase branch is where it accumulates.

## Worktrees

- Every issue branch is worked on in its own worktree under `.worktrees/`, created and removed with the scripts described in `docs/repository-structure.md`.
- App and package code is never edited in the main checkout. Planning files, docs and agent configuration may be.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`. The scope is the app or package, for example `feat(api): add experience endpoints`.
- Summary in the imperative, lower case, no trailing period.
- Commits on an issue branch may be small and frequent; they are squashed when the issue is merged. Where test-first is mandatory, the test commit comes before the implementation commit so the reviewer can see the order.

## Issue pull requests

- Opened by the orchestrator against the phase branch once checks are green and the reviewer has approved.
- Title in Conventional Commits form — it becomes the squash commit message.
- Description:

```
Closes #<issue>

## What changed
<two or three sentences>

## How it was verified
<tests, screenshots, evals>

## Roles
Implemented by: <agent>
Reviewed by: <agent>
Orchestrated by: <agent>
```

- UI changes attach the screenshots at 360, 768 and 1280 px in both themes.
- A change in behaviour or structure includes the documentation update.
- Merged by the orchestrator with a **squash merge** when the reviewer has approved and CI is green on the pull request. The result is one commit per issue on the phase branch.
- `Closes #<issue>` only closes issues on merges into `master`, so after the merge the orchestrator closes the issue itself, with a comment naming the pull request, and deletes the local issue branch.

## Phase pull request

- Opened by the orchestrator from the phase branch to `master` when no ready issue of the phase remains.
- The description lists the issues of the phase with their pull requests, and anything skipped or failed.
- The owner reviews the phase as a whole and is the only one who merges it. It is merged with a **merge commit**, so `master` keeps one commit per issue plus one commit marking the phase.
- CI must be green on the phase branch.

## Rules that never bend

- Nobody but the owner merges into `master`. Nobody pushes to `master` directly.
- Nobody force-pushes a shared branch (`master`, a phase branch).
- A failing check is fixed, not bypassed.

## What stays out of the history

No `fix`, `fix2`, `try again` on `master`. Each commit there is one issue with one meaningful message.

## The phase loop

A phase can be processed unattended. See `docs/agents.md`.
