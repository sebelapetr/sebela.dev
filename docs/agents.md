# Agents

How coding agents are organised in this repository.

## Principle: roles are agents, knowledge is `AGENTS.md`

There is a small number of agents, one per role. What differs between parts of the codebase is knowledge, and knowledge lives in an `AGENTS.md` file inside each app and package — not in more agents.

## Instruction files

| File                         | Holds                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (root)           | Repository-wide rules                                                                                      |
| `<app or package>/AGENTS.md` | Only what is specific to that part: how to add an endpoint, how to write a migration, how to run its tests |
| `.claude/rules/*.md`         | Short reminders that point to a document in `docs/`; some are scoped to paths                              |
| `docs/`                      | The full, binding description                                                                              |

There are no `CLAUDE.md` files. Claude Code reads `AGENTS.md` directly when no `CLAUDE.md` exists, and other coding agents read `AGENTS.md` too.

A subagent may start without project instructions loaded. Every agent therefore begins by reading the root `AGENTS.md` and the `AGENTS.md` of each part it will touch.

### Path-scoped rules

A rule with `paths` in its frontmatter loads when an agent reads, writes or edits a matching file; the others load in every session. Each scoped rule names the binding documents of its area and repeats only the few points most often missed. A rule is added when its area exists — no empty app or package is created to hold one — and is extended when an app or package arrives in a later phase.

| Rule                      | Loads for                                                                                                     | Points to                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shared-configuration.md` | `packages/config/`, every `eslint.config.js`, `prettier.config.js`, `.prettierignore`, every `tsconfig*.json` | `packages/config/AGENTS.md`, code standards, dependency rules                      |
| `repository-checks.md`    | `scripts/checks/`                                                                                             | The hard-coded configuration check, the CI commit-message check, testing (tooling) |
| `harness.md`              | `harness/`, `.claude/settings.json`, `.claude/agents/`                                                        | Permissions, agents, git workflow (local hooks), worktree isolation                |
| `toolchain-and-ci.md`     | Every `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `.nvmrc`, `.github/workflows/`   | Toolchain and workspace, root commands, CI                                         |
| `local-infrastructure.md` | `compose.yaml`, `.env.example`                                                                                | Ports and worktree isolation, the shared Postgres, configuration and environment   |

## Project-local design and testing references

The repository carries `codebase-design` and `tdd` under `.claude/skills/`. They adapt Matt Pocock's references to the binding docs: interface design and incremental behaviour tests, with our API trust boundary, real-Postgres integration and existing approval model. Read the relevant `SKILL.md` directly when a harness has no skill invocation tool. No global skill installation or duplicate in a user-level directory is needed.

[`GLOSSARY.md`](../GLOSSARY.md) is the canonical vocabulary source. Read it when a task names or changes domain concepts. Update it when a term or meaning is settled; do not turn it into a specification or duplicate the domain rules in `docs/domain-context.md`.

Root instructions and the always-loaded Claude deep-module rule point to the canonical docs. Skills are reference material, not additional orchestration: they do not launch a codebase survey, spawn agents, install dependencies or reopen an approved issue on their own. Source revisions, adaptations and MIT notices live beside the local references. Update docs and the local references together when a convention changes.

## Roles

| Agent              | Does                                                                                                                            | Works in                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| orchestrator       | Takes issues, creates worktrees, dispatches the other agents, opens pull requests, merges reviewed issues into the phase branch | Whole repository                                                                |
| backend-developer  | Implements                                                                                                                      | `api`, `db`, `services`, `contracts`                                            |
| frontend-developer | Implements; takes screenshots for visual review                                                                                 | `web`, `ui`                                                                     |
| ai-developer       | Implements evals-first                                                                                                          | `mcp-admin`, `ai-service`, `mcp-public`, `llm-agent` (Python package), `memory` |
| reviewer           | Checks; has no write access to code                                                                                             | Whole repository                                                                |
| docs-keeper        | Keeps `docs/`, rules and `AGENTS.md` files in line with the code                                                                | Documentation                                                                   |
| steward            | Watches an unattended run and reports whether it is healthy; has no tools                                                       | Facts the loop gives it                                                         |
| retrospective      | Suggests, from a finished phase's report and agent memory, what to promote into docs or fix; has no tools                       | Facts the loop gives it                                                         |

Definitions live in `.claude/agents/`. A dedicated agent for a single app is added only if that part proves to need one.

### Model and effort

Each agent pins its model and effort level in the frontmatter of its `.claude/agents/<name>.md`, so a run does not depend on what the owner last chose in an interactive session.

| Agent                             | Model  | Effort | Why                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orchestrator                      | sonnet | medium | Coordinates issues, worktrees and pull requests; writes no code                                                                                                                                                                                                               |
| backend-, frontend-, ai-developer | opus   | medium | Writes the code and the tests; the model is kept, the effort lowered because a developer's own reasoning is what fills its context (phase 1 measurement: 100–220k output tokens and up to 195k context per issue). Auto-compaction at 150 000 tokens caps unusually long runs |
| reviewer                          | opus   | high   | Must find what the developer missed                                                                                                                                                                                                                                           |
| docs-keeper                       | sonnet | low    | Compares documents with merged code                                                                                                                                                                                                                                           |
| steward                           | haiku  | medium | Asked about once an hour with facts already gathered; judges, writes nothing                                                                                                                                                                                                  |
| retrospective                     | sonnet | medium | Asked once per phase; must tell a durable finding from a one-issue note                                                                                                                                                                                                       |

The environment variables `CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` override these fields; the phase loop sets neither. The reviewer stays at high effort, so that lower developer effort is checked by a thorough review.

An interrupted run can leave an issue's branch and worktree behind. The orchestrator continues that work instead of starting over (`.claude/agents/orchestrator.md`, step 3).

## Orchestration

For each issue of a phase:

1. The orchestrator picks an issue labelled `ready-for-agent` whose blockers are closed.
2. It creates an issue branch from the phase branch and a worktree; the worktree gets its own database and ports.
3. It dispatches the developer agent that matches the area of the issue.
4. The developer implements according to `docs/testing.md` and finishes with green checks and a summary. Its edits are formatted as it works, and its handoff is refused while lint or typecheck of what it changed fail (see [handoff checks](permissions.md#handoff-checks)).
5. The orchestrator dispatches the reviewer.
6. The reviewer approves or returns objections; objections go back to the developer.
7. The orchestrator opens the issue pull request against the phase branch.
8. When CI is green, the orchestrator squash-merges it into the phase branch. The issue closes.
9. The orchestrator runs the docs-keeper on the merged change and removes the worktree.

When no ready issue of the phase remains, the orchestrator opens the phase pull request to the phase's base branch — `master`, except for the trial — and stops. The owner reviews and merges it.

## The phase loop

A phase can run unattended:

```
harness/run-phase.sh <phase-folder>
```

- **One iteration, one issue.** The script starts Claude Code non-interactively with the orchestrator agent and the instruction to take the next ready issue of the phase through to a merged issue pull request. Every iteration starts with a clean context.
- **State lives in GitHub**, not in the script: issue labels, open and merged pull requests, the phase branch. The script can be stopped and started again at any time and continues where it left off.
- **Usage limit.** When a run ends because the usage limit is reached, the script waits ten minutes and tries again, until the limit lifts. A wait counts neither as a failure nor as an iteration, and Ctrl+C ends it at once.
- **End.** The loop ends when no ready issue of the phase remains; the phase pull request is then open and the loop writes [the phase report](#the-phase-report).
- **Before each iteration** (`harness/preflight.mjs`, rules in `harness/lib/preflight.mjs`) the loop checks the machine. Docker not running, Postgres not healthy or `gh` not signed in stop the loop with what to do, because every agent would otherwise fail or try to work around it. A main checkout that is not on the base branch, is behind `origin/<base>` or has uncommitted changes is only a warning, printed before the first iteration: the owner may mean it.
- **Progress.** An iteration's first line says how many of the phase's issues are closed (`(3/21 issues closed)`). Every half minute the loop reads the orchestrator's transcript and prints a line when it picks an issue or hands it to another agent (`#24 feat/24-generated-api-client → reviewer`); rules in `harness/lib/progress.mjs`.
- **Cost.** Each iteration's log line ends with what the run cost and how long it took, from the orchestrator's result (`merged #22 ($4.07, 24 min): …`); subagents are included.
- **Notifications.** On Windows (WSL) the loop shows a notification, which stays until dismissed, when the steward reports a new problem, when it cannot start an iteration, when it waits for the usage limit for the first time in a row and when it ends — phase done, too many failures or the iteration limit. Not on Ctrl+C: the owner is there. `harness/lib/notify.mjs` uses the toast API that ships with Windows through `powershell.exe`; elsewhere it does nothing. `--no-notify` turns them off.
- **Guards against spinning:**
  - an issue that fails once gets the label `agent-retry`; a second failure gets `agent-failed` (and loses `agent-retry`), and it is skipped from then on;
  - HITL issues are always skipped;
  - after several consecutive failed runs the script stops;
  - every run writes a log outside git.
- **Sequential.** One issue at a time. Parallel runs are a later improvement.
- **How a run ends:** the orchestrator finishes every unattended run with a structured report (merged, failed or phase done). The loop reads it — or recognises a usage limit — and decides what follows. It labels failed issues itself; the orchestrator does not change labels.
- **Options:** `--base <branch>` (default `master`; the trial uses `phase/00-overview`), `--wait-minutes`, `--max-failures`, `--max-iterations`, `--steward-minutes` (default 15, 0 turns the steward off), `--no-notify`. Logs are in `.worktrees/logs/<phase>/`.
- **Unattended permissions:** the loop runs in auto mode with prompts refused. Calls on the allow list run; any other call is judged by the auto-mode classifier and refused if it is held back. The deny list and the guard hook apply on top.
- **MCP servers:** the loop loads only `harness/mcp.json` (context7 for library documentation, Playwright for UI checks) with `--strict-mcp-config`, and turns off claude.ai connectors. The owner's personal servers — mail, calendar, drive — are never available to an unattended run.
- **Settings:** the loop loads only the repository's settings (`--setting-sources project,local`). The owner's `~/.claude` — plugins, global rules, personal agents and skills — does not reach an unattended run, so it behaves the same on any machine.
- **Agent memory:** developers and the reviewer have `memory: local`. Their memory lives in the main checkout under `.claude/agent-memory-local/<agent>/` (ignored by git), shared by all worktrees and runs, and is the one place in the main checkout's `.claude/` an unattended run may write. It holds verified, practical findings; `docs/` and `AGENTS.md` win over it. The orchestrator, as the main session, uses Claude Code's auto memory for the repository; subagents do not see that.
- **Temporary files:** agents put scratch files in `.tmp/` inside their worktree (ignored by git), never in `/tmp`, so parallel runs cannot collide.
- **Foreground subagents:** the loop sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, so the orchestrator waits for each developer and reviewer instead of ending its run while they still work.

### The steward

While an iteration runs, the loop starts `harness/steward.mjs` every 15 minutes. It **only reports**: one line in the loop's console — green `ok`, yellow warning, red problem, then who works on which issue, for how long, with how many calls and how much context, and how far the phase is (`[steward] ok · backend-developer on #24 · 16 min · 73 calls · context 136k · phase 3/21`) — and an entry in `.worktrees/logs/<phase>/steward.jsonl`. It never stops, fixes or merges anything. A problem that was not there at the check before also shows a notification.

1. **Rules, no model** (`harness/lib/steward.mjs`): from the orchestrator's and the current subagent's transcripts (found by the session id the loop gives each run), the phase's open pull requests, Postgres and the worktree slots it gathers how long the iteration has run, how long nothing has happened, refusals of the same command repeated within 15 minutes, the agent's calls and context, failing CI, new `agent-failed` issues and worktrees of merged pull requests still present at two checks in a row. Fixed limits turn them into warnings or problems: an iteration over 45 minutes is a warning and over 90 a problem; 15 minutes without activity a warning and 30 a problem; Postgres not healthy a problem.
2. **A small model when needed:** when a rule finds something, and once an hour anyway, the `steward` agent (Haiku, medium effort, no tools) gets the facts, the findings and the latest transcript entries and judges what rules cannot — whether the agent repeats a failing approach, works outside its task or waits for nothing. It can explain or add to the rules' findings but never makes them less severe.

Automatic intervention is a later step, once the reports have shown they are reliable.

### The phase report

When the phase pull request opens, the loop writes `.worktrees/logs/<phase>/report.md` (`harness/phase-report.mjs`, rules in `harness/lib/phase-report.mjs`): iterations, cost and time in total and per issue, review rounds per issue, iterations that finished no issue, the steward's checks and distinct findings, the most frequent guard refusals and the agent memory files changed during the phase. When memory changed, the `retrospective` agent (Sonnet, medium effort, no tools) reads the report and those files and adds suggestions: which notes to promote into `docs/` or an `AGENTS.md`, what to fix in instructions or the harness, and which notes to drop. The owner acts on them before the next phase; nothing is changed automatically. `node harness/phase-report.mjs <phase> [--no-model]` writes the report at any time.

### Compaction

Before any compaction, automatic or `/compact`, the `PreCompact` hook (`harness/hooks/pre-compact.mjs`) tells the summary what an issue's work must keep: issue, branch and worktree, the acceptance criteria verbatim, the test-first state, unresolved errors, the reviewer's objections verbatim, decisions and what remains. Developers compact at 150 000 tokens, so this keeps a long issue on track after the summary.

The reviewer agent is the only check between issues inside a phase, so a mistake in one issue can carry into the next before the owner sees it. CI on the phase branch and the owner's review of the whole phase are the safety net.

## What the reviewer checks

- Every acceptance criterion of the issue
- Package boundaries and the trust boundary
- Access: every write is a private, authenticated route; the API key never reaches client-side code
- Where test-first is mandatory: the test came before the implementation
- UI: screenshots at three widths and both themes
- MCP and AI: evals exist and meet their threshold
- Documentation updated when behaviour or structure changed
- No weakened checks, no hard-coded environment values, no real personal data

## Documentation upkeep

Documentation is updated in the same pull request as the change. The docs-keeper is a safety net: after a merge it compares the change with the docs and, if it finds drift, opens a small follow-up pull request.

## Human in the loop

The owner reviews every phase and is the only one who merges into `master`. Inside a phase, the orchestrator merges reviewed issue pull requests into the phase branch.

Issues are either AFK (an agent can finish them alone) or HITL (they need a decision or a design review from the owner). The loop skips HITL issues.
