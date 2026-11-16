---
paths:
  - "scripts/harness/**"
  - "scripts/run-phase.sh"
  - ".claude/settings.json"
  - ".claude/agents/**"
---

# Harness

Before changing the loop, the worktree scripts, a hook, the permission settings or an agent definition, read `docs/permissions.md` (including Hooks and How it is enforced), `docs/agents.md`, "Local hooks" in `docs/git-workflow.md` and "Ports and worktree isolation" in `docs/repository-structure.md`.

- The harness stays plain Node with no dependencies. It starts the workspace's tools as programs from the checkout's `node_modules/.bin`; it never imports them. `node --test scripts/harness/` runs without `pnpm install`.
- Project hooks add to the existing configuration and the owner's global settings. Never remove or weaken the guard, the worktree hooks, the merge reminder or a deny rule.
- A change to a security rule of the guard or a hook starts with a failing test.
- Hooks act on the worktree the agent or commit works in, report genuine failures instead of succeeding, and must not trigger themselves.
