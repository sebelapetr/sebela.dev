---
name: to-issues
description: Break a phase PRD from .plan/ into independently-grabbable GitHub issues using tracer-bullet vertical slices, published as ordered sub-issues of the phase's tracking issue with native blockers and a milestone. Use when the user wants to convert a PRD or plan into issues or implementation tickets.
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

Adapted from the `to-issues` skill in mattpocock/skills. Differences for this repository: the tracker is GitHub Issues (via the `gh` CLI) with a tracking issue, ordered sub-issues and native blockers per phase, the source is a PRD file in `.plan/`, and the acceptance criteria follow the rules in `AGENTS.md`.

## Tracker and structure

- Tracker: GitHub Issues of this repository, managed with `gh`.
- Structure (`docs/git-workflow.md`, Issues): a **milestone** per release → one **tracking issue** per phase → the phase's issues as its **sub-issues**, in the order they are to be worked on, with **native blocked-by links** for what must come first. The phase loop selects work from this structure alone (`docs/agents.md`, Work selection): a slice that is not a sub-issue of the tracking issue is never worked on, and its place among the sub-issues is its place in the phase.
- Labels say who may take an issue, not where it belongs: `afk` or `hitl`, and `ready-for-agent` once the user approved the breakdown. The tracking issue carries none of them.
- During the migration only (`docs/git-workflow.md`, Issues): every slice also gets the label `phase:NN-<phase>` (or `phase:NN.M-<name>`; matches the `.plan/` folder; create a missing one with `gh label create`) and a `## Blocked by` section that is a rendering of its native links. Nothing selects by them; drop both when that migration is finished.
- Publishing issues is outward-facing: only publish after the user approved the breakdown in step 4.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a PRD path (for example `.plan/07-ai-service/prd.md`) or an issue reference as an argument, read it in full. Always read `.plan/00-overview/prd.md` and `AGENTS.md` as well.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the vocabulary from `docs/` and respect existing decisions.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction beyond the PR approval. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer that exists in its phase (schema, service, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Slices that can run in parallel must not edit the same files; say so explicitly when two slices would collide
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Order**: the list is in the order the slices are to be worked on; it becomes the sub-issue order
- **Blocked by**: which other slices (if any) must complete first; they become native blocked-by links
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the order and the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Publish the issues to GitHub

**The order of work is the order of the sub-issues.** Put the approved slices into the order they are to be worked on; a blocker always comes before what it blocks. Publish in that order, so real issue numbers exist when a later slice names its blockers.

1. **Find or create the phase's tracking issue.** `node harness/phase-work.mjs phases` lists the open tracking issues with their plan folders. If the phase has none, create it: title `Phase NN · <name>`, no labels, the release's milestone, and a body that says it is the tracking issue of the phase, links the PRD and `issues.md`, and has this line on its own, exactly (the harness finds the phase by it):

   ```
   Plan: .plan/NN-<phase>
   ```

   A phase that must wait for another phase gets a native link between the two tracking issues: `gh issue edit <tracking> --add-blocked-by <other tracking issue>`. Ask the user which phases it waits for; the overview PRD's phase table names the dependencies.

2. **Ask which milestone** the phase belongs to if the tracking issue has none (`gh api "repos/{owner}/{repo}/milestones" --jq '.[].title'`). Every slice gets the same milestone as its tracking issue.

3. **Create each slice, in order,** with the template below, as a sub-issue with its native blockers and the milestone in one command:

   ```
   gh issue create --title "<title>" --body-file <file> \
     --parent <tracking issue> --blocked-by <n>,<m> --milestone "<milestone>" \
     --label afk --label ready-for-agent --label "phase:NN-<phase>"
   ```

   Leave out `--blocked-by` for a slice without blockers and use `--label hitl` instead of `afk` for a HITL slice. A new sub-issue goes to the end of the list, so creating the slices in order gives the intended order. The `## Blocked by` section of the body lists exactly the issues given to `--blocked-by`, as `- #<n>` lines; explanations go below the list, never as another issue reference in that section.

4. **A slice added to a phase later** is created the same way. If its place is not the end, move it: get the node IDs with `gh issue view <n> --json id --jq .id` and run

   ```
   gh api graphql -f query='mutation($parent: ID!, $issue: ID!, $after: ID!) { reprioritizeSubIssue(input: { issueId: $parent, subIssueId: $issue, afterId: $after }) { issue { number } } }' -f parent=<tracking id> -f issue=<slice id> -f after=<id of the sub-issue it follows>
   ```

5. **Check the result.** `node harness/phase-work.mjs next NN-<phase>` must print the first slice an agent may take (or say that the phase waits for another phase) and list the others in the intended order with their blockers; `node harness/phase-work.mjs blockers` must report that every `## Blocked by` text and the native blockers agree. Fix what differs — the native links are the truth, the text follows them.

Then write `.plan/NN-<phase>/issues.md`: the tracking issue's number and a table of the published issues in sub-issue order (number, title, type, blocked by) so the breakdown is readable in the repository without the tracker.

<issue-template>
## Parent

Path of the PRD this slice comes from (for example `.plan/07-ai-service/prd.md`) and the user stories it covers.

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Security, API contract, service and bug-fix slices: tests were written first and fail without the implementation
- [ ] UI slices: acceptance criteria met and verified with Playwright and screenshots at 360, 768 and 1280 px, in light and dark mode (test-first not required for layout and visual polish)
- [ ] MCP / AI slices only: evals written first, pass threshold stated and met (EDD)
- [ ] Lint, typecheck, tests and build pass in CI

## Blocked by

- #<number of each native blocker, one per line>

Or "None - can start immediately." if no blockers. During the migration only: this section is a rendering of the issue's native blocked-by links and names no other issue.

</issue-template>

Do NOT close the tracking issue or change its text beyond what step 5 says, and do not change the order, blockers or labels of issues that already exist unless the user asked for it.
