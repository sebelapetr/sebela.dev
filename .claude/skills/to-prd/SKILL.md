---
name: to-prd
description: Turn the current conversation context into a PRD and save it under .plan/ in this repository. Use when the user wants to create a PRD from the current context (the overview PRD or a per-phase PRD).
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

Adapted from the `to-prd` skill in mattpocock/skills. Differences for this repository: PRDs are files in `.plan/`, not tracker issues; they are written in English; they must stay consistent with the overview PRD.

## Where PRDs live

- `.plan/00-overview/prd.md` — the overview PRD: vision, phases, architecture, cross-cutting rules. Every other PRD defers to it.
- `.plan/NN-<phase>/prd.md` — one PRD per phase (see the phase table in the overview PRD for the folder names).
- `.plan/NN.M-<name>/prd.md` — a sub-phase: independently deliverable work that builds on phase NN without blocking or bloating it (connecting a capability, measured improvements, an experiment swapping a component). Suggest one when a request would otherwise stretch a running phase; add a row right after the parent in the overview PRD's phase table and name its dependencies. On GitHub a phase or sub-phase is one tracking issue with the line `Plan: .plan/<folder>`, its issues are that issue's sub-issues, and its dependencies on other phases become native blocked-by links between the tracking issues; `to-issues` creates all of that from the PRD (`docs/git-workflow.md`, Issues) — there is no phase label to invent and no order by issue number. A few issues that belong to a running phase go into that phase instead. A phase merged into `master` is archived in `.plan/done/NN-<phase>/`; earlier decisions are read there.

`.plan/` is committed. Never put personal raw notes or private data in it — those belong in `.context/` (gitignored).

## Process

1. Read `.plan/00-overview/prd.md` and `AGENTS.md` first. If the PRD you are writing contradicts the overview, stop and raise it with the user; if the user confirms the change, update the overview PRD in the same change.

2. Explore the repo to understand the current state of the codebase, if you haven't already. Use the vocabulary from `docs/` throughout the PRD and respect existing decisions.

3. Sketch out the major modules you will need to build or modify. Actively look for opportunities to extract deep modules that can be tested in isolation.

   A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

   Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

4. Write the PRD using the template below and save it to the right folder in `.plan/`. Do not publish it to the issue tracker — the phase's tracking issue and its ordered sub-issues are created from it later with the `to-issues` skill.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)
- For MCP and AI features: which evals exist, what they measure and the pass threshold (evals-driven development)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
