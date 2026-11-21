---
name: to-issues
description: Break a phase PRD from .plan/ into independently-grabbable GitHub issues using tracer-bullet vertical slices. Use when the user wants to convert a PRD or plan into issues or implementation tickets.
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

Adapted from the `to-issues` skill in mattpocock/skills. Differences for this repository: the tracker is GitHub Issues (via the `gh` CLI), the source is a PRD file in `.plan/`, and the acceptance criteria follow the rules in `AGENTS.md`.

## Tracker and labels

- Tracker: GitHub Issues of this repository, managed with `gh`.
- Labels: `phase:NN-<phase>` or `phase:NN.M-<name>` for a sub-phase (matches the `.plan/` folder), `afk` or `hitl`, and `ready-for-agent` once the user approved the breakdown. Create missing labels with `gh label create`.
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
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Publish the issues to GitHub

For each approved slice, create an issue with `gh issue create` using the template below. Publish in dependency order (blockers first) so you can reference real issue numbers in the "Blocked by" field.

Then write `.plan/NN-<phase>/issues.md`: a table of the published issues (number, title, type, blocked by) so the breakdown is readable in the repository without the tracker.

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

- A reference to the blocking issue (if any)

Or "None - can start immediately" if no blockers.

</issue-template>

Do NOT close or modify any parent issue.
