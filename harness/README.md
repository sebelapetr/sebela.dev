# harness

The agent harness of this repository: what lets coding agents work through a phase of GitHub issues unattended, each issue in its own worktree, while the owner reviews one pull request per phase. Plain Node, no dependencies; `node --test harness/` runs its tests without `pnpm install`.

| Part                            | What it does                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-phase.sh`, `run-phase.mjs` | The phase loop: starts the orchestrator agent once per issue, waits out usage limits, labels failing issues `agent-retry` and `agent-failed`, stops when the phase pull request is open |
| `worktree.mjs`                  | Creates and removes a worktree per branch with its own slot, ports, database and database role in the shared Postgres; continues an interrupted issue's branch                          |
| `hooks/`                        | Claude Code hooks: the guard that refuses forbidden actions, formatting of edited files, worktree set-up and the post-merge reminder                                                    |
| `git-hooks/`                    | Git hooks (formatting, commit messages) installed by `pnpm install`                                                                                                                     |
| `lib/`                          | The pure rules behind them — slots, the loop's decision table, the guard — with their tests                                                                                             |
| `mcp.json`                      | The only MCP servers an unattended run loads                                                                                                                                            |
| `setup-github.sh`               | Labels and protection of `master`; run once by the owner                                                                                                                                |

Run a phase (owner only, with Postgres running in the main checkout):

```sh
harness/run-phase.sh <phase-folder> [--base <branch>]
```

How the agents work together: [docs/agents.md](../docs/agents.md). What they may and may not do, and how it is enforced: [docs/permissions.md](../docs/permissions.md). Why the harness is shaped this way: [docs/decisions/0007](../docs/decisions/0007-phase-branch-and-loop.md) and [0013](../docs/decisions/0013-harness-at-the-top-level.md).
