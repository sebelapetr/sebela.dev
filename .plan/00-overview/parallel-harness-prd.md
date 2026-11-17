# Harness — parallel phase loop

|        |                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Draft, awaiting approval                                                                                                                 |
| Date   | 2026-11-16                                                                                                                               |
| Parent | `.plan/00-overview/harness-prd.md` (its Out of Scope: "Parallel processing of issues")                                                   |
| Built  | By hand, in an interactive session, between phases — the loop cannot rebuild itself while it runs                                        |
| Result | `harness/run-phase.sh <phase> --parallel 3` works on up to three unblocked issues at once, and the phase branch keeps every issue's work |

## Problem Statement

The phase loop handles one issue at a time. An issue takes 20–40 minutes, so a phase of 21 issues (phase 2) needs eight to nine hours of wall time even when nothing goes wrong. Many issues of a phase do not depend on each other and could be worked on at the same time.

Running issues in parallel brings two new risks:

- Two runs could pick the same issue.
- One run could merge its work in a way that undoes another's.

Both have to be ruled out by the harness, not left to agents' care.

## Solution

The loop itself chooses which issues to work on and keeps up to N of them in progress, each in its own worktree with its own orchestrator run. The default is N = 3, set with `--parallel N`; `--parallel 1` behaves as today.

Merging into the phase branch goes through one harness command, `node harness/merge.mjs`, which merges one pull request at a time. A pull request that is behind the phase branch is not merged. Its orchestrator first merges the phase branch into the issue branch, resolves any conflicts so that both issues' intent holds, runs the checks again, and has the reviewer look at the resolution.

Usage limits are accepted: the owner prefers using the limit up early to leaving it unused. When the limit is reached, every run waits and resumes.

## User Stories

1. As the owner, I want several unblocked issues worked on at once, so that a phase finishes in a fraction of the wall time.
2. As the owner, I want to choose how many run at once (`--parallel 2`, `3`, `4`), so that I can trade speed against usage and machine load.
3. As the owner, I want no issue picked twice and no blocked issue started, so that parallel runs never duplicate or pre-empt work.
4. As the owner, I want work already merged into the phase branch never lost by a later merge, so that parallel runs add up instead of overwriting each other.
5. As the owner, I want the console, the steward and the notifications to tell the runs apart, so that I can still see who is doing what.
6. As the owner, I want stopping and restarting to keep working as today: a restart resumes every issue that has a branch, before starting new ones.
7. As the orchestrator, I want to be given one issue rather than pick one, so that I never race another run.
8. As the orchestrator, I want a merge command that tells me when my branch is behind and what to do, so that I resolve conflicts before, not after, merging.
9. As a developer agent, I want clear rules for files that conflict by nature (the lockfile, migrations, shared exports), so that I resolve them the same way every time.
10. As the reviewer, I want to see the conflict resolution as its own diff, so that I can check that nothing from the phase branch was dropped.

## Implementation Decisions

### Scheduling (the loop)

- A pure module, `harness/lib/scheduler.mjs`, decides which issues to start. Its input is the phase's issues (number, labels, state, the `## Blocked by` list in the body), the issue branches that exist and the issues in progress. Its output is the issues to start now. It has no shell, network or agent in it.
- **Ready** means: open, labelled `ready-for-agent`, not `hitl` or `agent-failed`, and every issue under `## Blocked by` closed.
- **Order:** issues with an existing branch first (interrupted work), then ascending issue number. That is the order the issues were planned in.
- **Claiming:** the loop is the only one that assigns issues, so two runs cannot take the same one. While a run works on an issue, the loop keeps that issue in memory. After a restart, an existing branch `*/<n>-*` counts as claimed and is resumed first. GitHub stays the source of truth; nothing new is stored.
- **Areas that conflict:** two issues that both change the database schema or migrations are not run at the same time. To support this, issues get an area label (`area:db`, `area:api`, `area:web`, `area:ai`, `area:harness`) when they are written, and the scheduler starts at most one `area:db` issue at a time. An issue without an area label runs alone with respect to other unlabelled issues; see open question 1.
- Each worker is today's iteration with one issue named in the prompt: "Handle issue #N". The orchestrator no longer picks; steps 1–2 of its flow are replaced by the given issue. With `--parallel 1` the loop still names the issue, so there is one code path.
- **Usage limit:** when one run reports a limit, the loop starts nothing new, waits as today, and then restarts every interrupted issue. The runs resume their branches.
- **Failures:** labelling (`agent-retry`, `agent-failed`) is per issue as today. The stop after several consecutive failures counts across all runs.
- **Phase done:** when nothing is ready and nothing is in progress, one final orchestrator run opens the phase pull request.

### Merging (one at a time)

- `node harness/merge.mjs <pr>` replaces `gh pr merge` for the orchestrator:
  1. It takes a lock: a file under `.worktrees/` in the main checkout, holding the process id, with a stale lock taken over after a timeout.
  2. It checks that the pull request targets the phase branch, has an approving review recorded by the orchestrator, has green CI, and is not behind the phase branch.
  3. Only then does it squash-merge and release the lock.
- When the branch is behind, the command does not merge. It says so, with the instruction: run `git merge origin/phase/<phase>` in the worktree, resolve, run the checks, ask the reviewer to review the resolution, push, and call it again.
- In the loop, the guard refuses `gh pr merge` and allows `node harness/merge.mjs`. Interactive use keeps `gh pr merge` under the existing rules.
- The docs-keeper's follow-up changes go through the same command.

### Conflicts: keeping every issue's work

- Branches are brought up to date by **merging** the phase branch in, never by rebasing. Force-push stays refused. History therefore always contains the other issues' commits, and nothing can be dropped silently.
- **Resolution rules** go in `docs/git-workflow.md`, with a short pointer in each developer agent:
  - The result must do what both issues' acceptance criteria and the PRD ask. When the two cannot both hold, report the issue as failed with the reason; do not choose.
  - `pnpm-lock.yaml` is never edited by hand: take the phase branch's version, run `pnpm install`, commit the result.
  - Migrations: keep the phase branch's migrations unchanged and regenerate this branch's migration on top of them.
  - Generated files (the API client, OpenAPI output) are regenerated, not merged by hand.
- **The reviewer checks the resolution** as its own diff: the merge commit against both parents. The question is whether everything from the phase branch is still there and both issues' intent holds. An extra review round costs less than a lost change.
- CI runs on the issue pull request after the update and on the phase branch after every merge, as today.

### What the owner sees

- Every loop line carries its issue: `[#24] backend-developer → reviewer`, `[#24] merged ($5.10, 38 min)`. A summary line comes at each change: `in progress: #24, #25, #31 · phase 6/21`.
- The steward checks each run separately and prints one line per run. Its Postgres and CI findings are reported once, not per run.
- Notifications as today; a usage-limit notification once for all runs.
- The phase report adds the wall time next to the agent time, and the number of conflict-resolution rounds per issue.

### Machine load

Three developers can each run `pnpm install`, tests and builds at once inside WSL. The default stays 3; the owner lowers it with `--parallel` if the machine struggles. Each worktree already has its own ports (slots 0–9) and its own database, so nothing else collides.

## Testing Decisions

- **Tested first, in isolation:** the scheduler (blockers, claiming, resume first, area exclusion, the limit across runs, phase done only when nothing is in progress), and the merge command's decisions (behind, not approved, CI not green, lock held, stale lock).
- **End to end against a temporary repository,** like `harness/worktree-databases.e2e.mjs`: two branches touching the same file, merged one after the other through `merge.mjs`. The second is refused until it has merged the first, and the phase branch then contains both changes.
- **Guard:** `gh pr merge` refused in the loop and `node harness/merge.mjs` allowed, test-first.
- **Trial:** one real phase run with `--parallel 2` before the default of 3 is used.

## Rollout

1. Scheduler and `--parallel 1`, the same behaviour as today but with the loop naming the issue. Run it for a few issues.
2. `merge.mjs` and the conflict rules, with the guard change.
3. `--parallel 2` on a real phase, then 3 as the default.
4. A decision record in `docs/decisions/` and updates to `docs/agents.md`, `docs/git-workflow.md` and `harness/README.md` in the same pull requests.

## Out of Scope

- Parallel phases, or issues of two phases at once.
- Running on more than one machine, in CI or in the cloud.
- Automatic intervention by the steward.
- Choosing N automatically from usage or machine load.

## Open Questions

1. **Area labels:** should the issue writer add them to the remaining phases' issues now, or should the scheduler derive the area from the developer agent the issue needs (backend, frontend, ai)? Labels are explicit but have to be added; deriving needs no change but is coarser.
2. **Which areas exclude each other:** is "one `area:db` at a time" enough, or should shared contracts (`packages/contracts`) also be exclusive?
3. **Reviewer on conflicts:** a full re-review, or a review of the resolution diff only? This draft assumes the resolution diff only.
