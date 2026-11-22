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

The owner refined it the same day ([three kinds of work](https://github.com/sebelapetr/sebela.dev/issues/420#issuecomment-7072743190); issue types, issue fields and assignees) and those decisions are part of this record.

1. **Three kinds of work,** all of which may sit in a milestone (a release):

   | Kind                      | What it is                                                                                                                      | How it is told apart                                                     | Issue type | How it is worked                                                         |
   | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
   | **Phase**                 | An epic with a PRD in `.plan/<folder>/`, the branch `phase/<folder>`, the owner's acceptance and one pull request into `master` | A tracking issue with sub-issues **and** the line `Plan: .plan/<folder>` | `Phase`    | Started by the owner with the phase loop, one sub-issue at a time        |
   | **Epic**                  | A group of related issues without a PRD, a phase branch or a loop                                                               | A tracking issue with sub-issues and **no** `Plan:` line                 | `Epic`     | By hand or by agents, each issue with its own pull request into `master` |
   | **Issue without an epic** | A single piece of work                                                                                                          | No parent                                                                | —          | The same, on its own                                                     |

   The phase loop refuses to run for a tracking issue without a `Plan:` line — no folder resolves to it — and never selects a tracking issue of either kind as work.

2. **The plan folder.** A phase's tracking issue names its plan folder in a line of its own, `Plan: .plan/<phase-folder>`, outside code blocks and comments. The harness resolves a phase folder to its tracking issue through that line, among issues opened by the owner, a member or a collaborator; none or several is an error. The phase branch stays `phase/<phase-folder>`, so the paid-eval trigger, the release rules and the worktree script, which go by that branch name, do not change.
3. **Selection is code.** For a phase, the next issue is the first open sub-issue of its tracking issue, in sub-issue order, that carries `ready-for-agent`, carries neither `hitl` nor `agent-failed`, has no sub-issues of its own and has no open issue among its native blockers. The state of each blocker is read; a link to a closed blocker does not block. The rule lives in `harness/lib/selection.mjs` and is asked through `node harness/phase-work.mjs next <phase-folder>` by the orchestrator, the loop, the steward and the phase report. The answer always carries an explicit status, and the phase end is keyed on it, never on a missing line.
4. **Order between phases** comes from native links between tracking issues: a phase whose tracking issue has an open blocker has not started. The loop stops before an iteration for it, as it does for a phase without issues; no agent is started that would cut its branch, archive its plan and open its pull request. A phase whose remaining issues wait for a human, are blocked, failed or unreleased still gets its phase end — the plan archived, the draft pull request opened, the remaining issues named — as before this decision.
5. **Tracking issues are never work.** They carry no `ready-for-agent`, and an issue with sub-issues is refused whatever it carries.
6. **Labels that stay** say who may take an issue, not where it belongs: `ready-for-agent`, `hitl`, `afk`, `agent-retry`, `agent-failed`.
7. **For people, never for the loop: issue types, issue fields, assignees.** Types: `Phase` and `Epic` for the two kinds of tracking issue, `Feature` (new behaviour a user can see; a `feat`), `Bug` (wrong behaviour; a `fix`), `Task` (everything else). They replace the labels `bug` and `enhancement`, which are no longer required; existing labels are left alone. Fields: `Priority` (Urgent, High, Medium, Low; the owner's ordering aid), `Start date` and `Target date` (for tracking issues when the owner sets dates), `Effort` (unused for now). Assignee: an issue labelled `hitl` is assigned to the owner, an issue an agent may take has none; every agent acts through the owner's account, so an assignee means only "this waits for a person". None of the three is an input of the selection: a value set by mistake must not change what an unattended loop does. `node harness/phase-work.mjs assignees` reports where `hitl` and the assignee disagree.
8. **No dependence on the GitHub Project.** Only what belongs to issues is read (text, author association, labels, parent, sub-issue order, blockers), with the `repo` scope. The project and its fields stay a view for the owner.
9. **State is re-read, never kept.** Every decision asks GitHub again.
10. **Migration.** The selection reads only the native structure from the start. Until one whole phase has run on it, `to-issues` still writes the `phase:` label and a `## Blocked by` section rendered from the native links, `harness/setup-github.sh` keeps the phase labels, and `node harness/phase-work.mjs blockers` reports every open issue whose section and native blockers disagree. Then the labels are removed from open issues, the label definitions deleted, and the section and the check dropped (`docs/git-workflow.md`, Issues). Closed issues keep their labels as history.
11. **Not in the middle of a running phase.** A running loop is one process that keeps the code it loaded, but each of its iterations starts a new agent that re-reads the agent definitions, the rules, `AGENTS.md`, the documents and every script from the main checkout as it is then. Pulling this change into the main checkout mid-run would give the next iteration an old prompt and a new definition that contradict each other. Merging on GitHub is safe; the main checkout is not pulled while a phase loop runs, but after it has ended and before another phase is started. Finishing a running phase on the new selection needs the owner's explicit waiver and the steps in `docs/agents.md` (Work selection, Changing the harness while a loop runs).

## Why

Two sources for one fact drift apart. The acceptance issue of phase 07 was natively blocked by four issues its text did not name, so a selection that read the text could not see them, and nothing showed the intended order of a phase's issues except their numbers — an issue added to a phase later could only come last. The selection was also prose in an agent's prompt: the orchestrator read sections of issue text and judged each time. A rule in code is the same every time, is tested without the network, and reports why nothing is eligible.

## Rejected

- **Keeping the labels and the text as the source and mirroring them natively.** The native structure is what the owner edits and sees in GitHub; the mirror would be the copy that drifts.
- **"Has no blocked-by link" as the test for eligibility.** A link to a closed blocker stays, so finished blockers would block for ever; the blockers' state is read instead.
- **Reading order or priority from the GitHub Project.** A project of a user account needs a token scope the workflow token never has, and the loop must not stop because of it.
- **Leaving the choice to the orchestrator with better instructions.** The same input must give the same issue; an agent reading prose does not guarantee that.
- **Switching the selection in the middle of a running phase.** Issue #420 rules it out, and a mid-run pull would mix an old prompt with new definitions (point 11). Text and native links were still brought into agreement first, so that the old rule and the new one pick the same issues of the phase that was running.
- **Issue types, fields or assignees as inputs of the selection.** They are easy to set by mistake in GitHub's interface, and an unattended loop must not change course because of that. They describe; the labels, the links and the order decide.
- **Trusting any issue with a plan line.** The repository is public: an outsider could create a phase or halt one by naming its folder a second time.
- **Giving a phase that waits for another phase to the orchestrator and letting it find nothing to do.** "Nothing to do" is how a phase ends; the agent would cut the branch from a base without the other phase, archive the plan and open a pull request.

## Relationship to earlier decisions

Extends [0007](0007-phase-branch-and-loop.md): the phase branch, the loop and "all state in GitHub" stand; what the state is has changed from labels and issue text to the native structure. The harness PRDs in `.plan/00-overview/` (`harness-prd.md`, `parallel-harness-prd.md`) still describe labels and the `## Blocked by` list as the input; they are plans of their time and are not rewritten — a scheduler for parallel runs would take its input from `harness/lib/selection.mjs`.

Open with the owner: whether milestone names carry a version number. The release workflow counts versions from the commits, so a milestone called `v1.0` and the tag do not meet by themselves ([issue #420](https://github.com/sebelapetr/sebela.dev/issues/420), Open decision).
