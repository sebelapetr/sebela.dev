# Permissions

What coding agents may do in this repository, and why. The configuration lives in `.claude/settings.json`; this document is the intent it implements.

## Principle

Free hands inside a worktree, hard limits at the boundaries. An agent should finish an issue without asking for confirmation at every step, and should be technically unable to do the few things that cause real damage.

## Allowed without asking

| Action | Why |
|---|---|
| Package manager and task runner commands, tests, lint, typecheck, build | Normal development |
| Reading git state; committing on the agent's own branch | Normal development |
| Compose commands for the local Postgres | Needed to run and test |
| Worktree setup and cleanup scripts | Part of the flow |
| Reading issues and pull requests | Context |
| Creating a pull request | The orchestrator does this on its own |
| Squash-merging a reviewed issue pull request into the phase branch (orchestrator only) | Lets a phase run unattended; the owner still reviews the whole phase before `master` |

## Needs the owner's confirmation

| Action | Why |
|---|---|
| Creating issues | Outward-facing and hard to undo cleanly |
| Anything the loop cannot decide alone | It stops and reports instead |
| Changing dependencies in a way the issue did not call for | Supply-chain and maintenance cost |

## Denied

| Action | Why |
|---|---|
| Reading `.env` files other than `.env.example` | Secrets |
| Reading `.context/` (subagents) | Raw private notes; the repository is public |
| Merging into `master`, pushing to `master`, force-pushing a shared branch | The owner is the only gate to `master` |
| Editing outside the agent's own worktree | Parallel agents must not collide |
| Editing app or package code in the main checkout | All code goes through a worktree and a pull request |

## Hooks

| When | What happens |
|---|---|
| After a file is edited | The file is formatted |
| Before a file is edited | An edit to app or package code in the main checkout is blocked |
| When a developer agent finishes | Typecheck and lint run for the packages it changed; failures go back to the agent |
| When a worktree is created or removed | The setup or cleanup script runs |
| After an issue is merged into the phase branch | The orchestrator is reminded to run the docs-keeper |

## How it is enforced

| Layer | Where | Covers |
|---|---|---|
| Permission rules | `.claude/settings.json` | What runs without asking, what asks, what is refused |
| Guard hook | `scripts/harness/hooks/pre-tool-use.mjs`, rules in `scripts/harness/lib/guard.mjs` | Code edits in the main checkout; environment files; `.context/` for subagents and the loop; pushes to `master` and force-pushes; merges — only by the orchestrator, only of this repository, only with `--squash`, only into a branch other than `master`. Search patterns of Grep and Glob are checked like paths. In the phase loop: `gh api`, `gh repo`, `gh secret`, `gh auth`, `gh label`, `gh workflow` and `git config` are refused, and a guard that fails refuses the call |
| Branch protection | GitHub, set by `scripts/harness/setup-github.sh` | `master` takes changes only through a pull request with green CI, for the owner too (admins are not exempt), with no force-push or deletion |

Rules on shell commands match the command as written, so they are a safety net, not a sandbox: an agent determined to get round them could. Branch protection on GitHub is the layer that cannot be talked round.

## Unattended runs

The phase loop runs Claude Code without a person present. In that mode nothing can be confirmed: an action that is not allowed here is simply refused and the run continues or stops. The allow and deny lists above are therefore the whole safety model of the loop — keep them tight.

## Notes

- Project settings add to the owner's global Claude Code settings; they must not replace the global hooks.
- Access to data at runtime (public and private API routes, API keys) is a different subject. See `docs/architecture.md` and `docs/domain-context.md`.
