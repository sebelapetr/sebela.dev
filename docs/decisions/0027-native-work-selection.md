# 0027 — Work is selected from milestones, phase tracking issues and native dependencies

Status: accepted
Date: 2026-11-22

## Decision

The owner decided on 2026-11-22 ([issue #420](https://github.com/sebelapetr/sebela.dev/issues/420)) that the harness, the skills and the documentation select and create work from GitHub's native structure:

| Before                            | Now                                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| Label `phase:<folder>`            | The phase's tracking issue, the parent of the phase's issues             |
| `## Blocked by` in the issue text | Native blocked-by links                                                  |
| Order by issue number             | The order of the sub-issues under the tracking issue                     |
| Nothing                           | A milestone per release, holding phases and small issues without a phase |

1. **Shape.** Milestone (a release) → phase tracking issues and small issues without a phase → sub-issues.
2. **The plan folder.** A tracking issue names its plan folder in a line of its own, `Plan: .plan/<phase-folder>`. The harness resolves a phase folder to its tracking issue through that line; none or several is an error. The phase branch stays `phase/<phase-folder>`, so the paid-eval trigger, the release rules and the worktree script, which go by that branch name, do not change.
3. **Selection is code.** For a phase, the next issue is the first open sub-issue of its tracking issue, in sub-issue order, that carries `ready-for-agent`, carries neither `hitl` nor `agent-failed`, has no sub-issues of its own and has no open issue among its native blockers. The state of each blocker is read; a link to a closed blocker does not block. The rule lives in `harness/lib/selection.mjs` and is asked through `node harness/phase-work.mjs next <phase-folder>` by the orchestrator, the loop, the steward and the phase report.
4. **Order between phases** comes from native links between tracking issues: a phase whose tracking issue has an open blocker waits, and nothing of it is selected.
5. **Tracking issues are never work.** They carry no `ready-for-agent`, and an issue with sub-issues is refused whatever it carries.
6. **Labels that stay** say who may take an issue, not where it belongs: `ready-for-agent`, `hitl`, `afk`, `agent-retry`, `agent-failed`.
7. **No dependence on the GitHub Project.** Only what belongs to issues is read (text, labels, parent, sub-issue order, blockers), with the `repo` scope. The project and its fields stay a view for the owner.
8. **State is re-read, never kept.** Every decision asks GitHub again.
9. **Migration.** The selection reads only the native structure from the start. Until one whole phase has run on it, `to-issues` still writes the `phase:` label and a `## Blocked by` section rendered from the native links, `harness/setup-github.sh` keeps the phase labels, and `node harness/phase-work.mjs blockers` reports every open issue whose section and native blockers disagree. Then the labels are removed from open issues, the label definitions deleted, and the section and the check dropped (`docs/git-workflow.md`, Issues). Closed issues keep their labels as history.

## Why

Two sources for one fact drift apart. The acceptance issue of phase 07 was natively blocked by four issues its text did not name, so a selection that read the text could not see them, and nothing showed the intended order of a phase's issues except their numbers — an issue added to a phase later could only come last. The selection was also prose in an agent's prompt: the orchestrator read sections of issue text and judged each time. A rule in code is the same every time, is tested without the network, and reports why nothing is eligible.

## Rejected

- **Keeping the labels and the text as the source and mirroring them natively.** The native structure is what the owner edits and sees in GitHub; the mirror would be the copy that drifts.
- **"Has no blocked-by link" as the test for eligibility.** A link to a closed blocker stays, so finished blockers would block for ever; the blockers' state is read instead.
- **Reading order or priority from the GitHub Project.** A project of a user account needs a token scope the workflow token never has, and the loop must not stop because of it.
- **Leaving the choice to the orchestrator with better instructions.** The same input must give the same issue; an agent reading prose does not guarantee that.
- **Switching the selection in the middle of a running phase by rewriting GitHub.** A loop that is already running keeps the rule it started with; text and native links were brought into agreement first, so both rules pick the same issues.

## Relationship to earlier decisions

Extends [0007](0007-phase-branch-and-loop.md): the phase branch, the loop and "all state in GitHub" stand; what the state is has changed from labels and issue text to the native structure. The harness PRDs in `.plan/00-overview/` (`harness-prd.md`, `parallel-harness-prd.md`) still describe labels and the `## Blocked by` list as the input; they are plans of their time and are not rewritten — a scheduler for parallel runs would take its input from `harness/lib/selection.mjs`.

Open with the owner: whether milestone names carry a version number. The release workflow counts versions from the commits, so a milestone called `v1.0` and the tag do not meet by themselves ([issue #420](https://github.com/sebelapetr/sebela.dev/issues/420), Open decision).
