---
paths:
  - "harness/**"
  - ".claude/settings.json"
  - ".claude/agents/**"
---

# Harness

Before changing the loop, the worktree scripts, a hook, the permission settings or an agent definition, read `docs/permissions.md` (including Hooks and How it is enforced), `docs/agents.md`, "Local hooks" in `docs/git-workflow.md` and "Ports and worktree isolation" in `docs/repository-structure.md`.

- The harness stays plain Node with no dependencies. It starts the workspace's tools as programs from the checkout's `node_modules/.bin`; it never imports them. `node --test harness/` runs without `pnpm install`.
- Project hooks add to the existing configuration and the owner's global settings. Never remove or weaken the guard, the worktree hooks, the merge reminder or a deny rule.
- A change to a security rule of the guard or a hook starts with a failing test.
- Work is selected by code, from GitHub's native structure only: the phase's tracking issue (`Plan: .plan/<phase-folder>`), its sub-issues in order, their labels and the state of their native blockers (`harness/lib/selection.mjs`, `node harness/phase-work.mjs`; `docs/agents.md`, Work selection). Never add a query by `phase:` label, an ordering by issue number or a reading of `## Blocked by` text, never make issue types, issue fields, assignees or the milestone an input, and never make the harness depend on the GitHub Project. What happens next is keyed on the command's `status:` line, never on a missing line. Do not pull the main checkout while a phase loop runs. A change to the selection rule starts with a failing test.
- Hooks act on the worktree the agent or commit works in, report genuine failures instead of succeeding, and must not trigger themselves.
