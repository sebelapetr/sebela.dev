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

No developer agent owns CI, release or infrastructure code: `.github/`, `scripts/release/`, `scripts/checks/`, `infra/` and `harness/`. A general agent (`general-purpose`) implements such an issue. The developer handoff hook (`harness/hooks/developer-handoff.mjs`, `SubagentStop`) covers only the three developer agents, and a general agent has no definition with a reading list (extending the hook is tracked in #371). The orchestrator's brief therefore tells it to read `AGENTS.md` and the relevant documents, to work test-first where `docs/testing.md` requires it, and to run lint, typecheck and the root checks (`pnpm ci:root`) itself before handing back. An independent `reviewer` is mandatory before the pull request is called ready, and verifies that those checks were run. Beyond its usual checks the reviewer verifies there that actions are pinned to commit SHAs, that no private term (hosting provider, server name, address or path) appears (`docs/permissions.md`, Private infrastructure details), that workflow permissions are least-privilege, that the change cannot start paid model evals unintentionally (`docs/testing.md`, CI), that script logic has test-first evidence, and that no check is weakened.

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

1. The orchestrator picks an issue labelled `ready-for-agent` whose blockers are closed. Before dispatching any agent it reads the whole issue, the `## Blocked by` and `## When` sections included, and every comment, and starts no issue whose blocker is still open (an issue blocked by an unmerged phase was once implemented early and its pull request started a paid eval run). It reads the issue with its comments: an `Owner note` in a comment is as binding as the body, and the orchestrator passes every owner note, as written, to the developer and the reviewer.
2. It creates an issue branch from the phase branch and a worktree; the worktree gets its own database, database role, ports and storage folder, is installed and migrated, and an empty profile is loaded with the demo seed.
3. It dispatches the developer agent that matches the area of the issue.
4. The developer implements according to `docs/testing.md` and finishes with green checks and a summary. Its edits are formatted as it works, and its handoff is refused while lint or typecheck of what it changed fail (see [handoff checks](permissions.md#handoff-checks)).
5. The orchestrator dispatches the reviewer.
6. The reviewer approves or returns objections; objections go back to the developer.
7. The orchestrator opens the issue pull request against the phase branch.
8. When CI is green, the orchestrator squash-merges it into the phase branch. The issue closes.
9. The orchestrator runs the docs-keeper on the merged change and removes the issue's worktree (`docs/git-workflow.md`, Worktrees).

When no ready issue of the phase remains, the orchestrator archives the phase's plan (it moves the phase's plan folder `.plan/<phase>/` to `.plan/done/<phase>/` with `git mv` and updates every reference to the old path in the repository, once, through a short-lived branch merged into the phase branch), opens the phase pull request to the phase's base branch — `master`, except for the trial — as a draft, and stops. HITL issues may still be open then. When the phase is complete, the owner marks the pull request ready for review, which runs the model evals of the affected suites once on the final state (`docs/testing.md`), and merges it when they pass.

## The phase loop

A phase can run unattended:

```
harness/run-phase.sh <phase-folder>
```

- **One iteration, one issue.** The script starts Claude Code non-interactively with the orchestrator agent and the instruction to take the next ready issue of the phase through to a merged issue pull request. Every iteration starts with a clean context.
- **State lives in GitHub**, not in the script: issue labels, open and merged pull requests, the phase branch. The script can be stopped and started again at any time and continues where it left off.
- **Usage limit.** When a run ends because the usage limit is reached, the script waits ten minutes and tries again, until the limit lifts. A wait counts neither as a failure nor as an iteration, and Ctrl+C ends it at once.
- **End.** The loop ends when the orchestrator reports that no ready issue of the phase remains. The loop then asks GitHub for the open pull request from `phase/<phase>` to the base and for the phase's open issues, and says which it is (`phaseEnd` in `harness/lib/loop.mjs`): **phase done** when the draft pull request is open and only HITL issues are left (named, to be done before the owner marks it ready), or **phase stopped: no workable issue left** when issues labelled `agent-failed`, blocked or unready issues remain or no phase pull request exists, listing them and the pull request or "no phase pull request". The notification says the same. Either way it writes [the phase report](#the-phase-report).
- **Before each iteration** (`harness/preflight.mjs`, rules in `harness/lib/preflight.mjs`) the loop checks the machine. Docker not running, Postgres not healthy or `gh` not signed in stop the loop with what to do, because every agent would otherwise fail or try to work around it. A main checkout that is not on the base branch, is behind `origin/<base>` or has uncommitted changes is only a warning, printed before the first iteration: the owner may mean it.
- **Progress.** An iteration's first line says how many of the phase's issues are closed (`(3/21 issues closed)`). Every half minute the loop reads the orchestrator's transcript and prints a line when it picks an issue or hands it to another agent (`#24 feat/24-generated-api-client → reviewer`), also when it sends objections back to the developer or fixes back to the reviewer it already started; the phase report counts those as further rounds; rules in `harness/lib/progress.mjs`.
- **Cost.** Each iteration's log line ends with what the run cost and how long it took, from the orchestrator's result (`merged #22 ($4.07, 24 min): …`); subagents are included.
- **Notifications.** On Windows (WSL) the loop shows a notification, which stays until dismissed, when the steward reports a new problem, when it cannot start an iteration, when it waits for the usage limit for the first time in a row and when it ends — phase done, phase stopped with nothing workable, too many failures, a repeated safeguard stop, an environment stop or the iteration limit. Not on Ctrl+C: the owner is there. `harness/lib/notify.mjs` uses the toast API that ships with Windows through `powershell.exe`; elsewhere it does nothing. `--no-notify` turns them off.
- **Guards against spinning:**
  - an issue that fails once gets the label `agent-retry`; a second failure gets `agent-failed` (and loses `agent-retry`), and it is skipped from then on;
  - HITL issues are always skipped;
  - after several consecutive failed runs the script stops;
  - every run writes a log outside git.
- **Sequential.** One issue at a time. Parallel runs are a later improvement.
- **How a run ends:** the orchestrator finishes every unattended run with a structured report (merged, failed, interrupted or phase done). Interrupted means something outside the issue stopped the work on it; the worktree and branch are kept and the report names the cause:
  - `usage_limit`: the loop waits as for any limit and continues the same issue;
  - `safeguard` (a model safeguard refused or stopped an agent): the loop retries once at once; a second safeguard stop in a row on the same issue stops the loop with a notification. The loop also recognises a safeguard that ends the `claude -p` run itself (stop reason `refusal`, safety stops counted, or usage-policy wording such as "Usage Policy", "AUP" or "content filtering policy" in the error) and treats it the same way. It remembers the last safeguard only while it runs;
  - `environment` (low disk, a missing tool or credential, a guard refusal that cannot be worked around without breaking a rule): the loop stops at once and the notification names the cause.

  None of them labels the issue or counts as a failure. The loop reads the report — or recognises a usage limit or a safeguard — and decides what follows. It labels failed issues itself; the orchestrator does not change labels.

- **Options:** `--base <branch>` (default `master`; the trial uses `phase/00-overview`), `--wait-minutes`, `--max-failures`, `--max-iterations`, `--steward-minutes` (default 15, 0 turns the steward off), `--no-notify`, `--note "<text>"` (below). Logs are in `.worktrees/logs/<phase>/`.
- **A note from the owner.** `harness/run-phase.sh <phase-folder> --note "<text>"` hands the orchestrator a note written when the loop is started, for example why the last run was stopped and what an unfinished issue still needs. It adds to the orchestrator's instructions and never replaces a rule or the guard. The loop keeps no state, so the orchestrator first records a note about an issue on that issue as a comment starting with `Owner note:`, where later runs find it. The note stays while the loop only waits for the usage limit and ends with the first run that finished, merged or failed, so it is not repeated to the issues that follow (`ownerNoteSection` and `noteAfter` in `harness/lib/loop.mjs`). A comment on the issue does the same without the option; the option saves the owner that step.
- **Unattended permissions:** the loop runs in auto mode with prompts refused. Calls on the allow list run; any other call is judged by the auto-mode classifier and refused if it is held back. The deny list and the guard hook apply on top.
- **MCP servers:** the loop loads only `harness/mcp.json` (context7 for library documentation, Playwright for UI checks) with `--strict-mcp-config`, and turns off claude.ai connectors. The owner's personal servers — mail, calendar, drive — are never available to an unattended run.
- **Settings:** the loop loads only the repository's settings (`--setting-sources project,local`). The owner's `~/.claude` — plugins, global rules, personal agents and skills — does not reach an unattended run, so it behaves the same on any machine.
- **Agent memory:** developers and the reviewer have `memory: local`. Their memory lives in the main checkout under `.claude/agent-memory-local/<agent>/` (ignored by git), shared by all worktrees and runs, and is the one place in the main checkout's `.claude/` an unattended run may write. It holds verified, practical findings; `docs/` and `AGENTS.md` win over it. The orchestrator, as the main session, uses Claude Code's auto memory for the repository; subagents do not see that.
- **Temporary files:** agents put scratch files in `.tmp/` inside their worktree (ignored by git), never in `/tmp`, so parallel runs cannot collide. The local storage driver of a development API keeps its uploads there too (`.tmp/storage/` by default, see `apps/api/AGENTS.md`).
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

- Every acceptance criterion of the issue, with the browser specs the change affects run once per review and none when it cannot change the website; the whole suite runs only in CI before the merge ([Browser tests by role](testing.md#browser-tests-by-role))
- Package boundaries and the trust boundary
- Access: every write is a private, authenticated route; the API key never reaches client-side code
- Where test-first is mandatory: the test came before the implementation
- UI: screenshots at three widths and both themes
- MCP and AI: evals exist and meet their threshold
- Documentation updated when behaviour or structure changed
- On every migration pull request: the migration follows the compatibility rule, so the previous release still runs on the new schema ([Release workflow](release-workflow.md#migration-compatibility-rule))
- No weakened checks, no hard-coded environment values, no real personal data

## Documentation upkeep

Documentation is updated in the same pull request as the change. The docs-keeper is a safety net: after a merge it compares the change with the docs and, if it finds drift, opens a small follow-up pull request.

## Human in the loop

The owner reviews every phase and is the only one who merges into `master`. Inside a phase, the orchestrator merges reviewed issue pull requests into the phase branch.

Issues are either AFK (an agent can finish them alone) or HITL (they need a decision or a design review from the owner). The loop skips HITL issues.

Agents cannot create issues. What an issue leaves for later goes into a comment on that issue, one line each starting with `Follow-up:`, and the orchestrator lists all of them in the phase pull request, where the owner decides which become issues.
