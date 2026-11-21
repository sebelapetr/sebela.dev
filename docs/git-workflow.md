# Git workflow

The git history of this repository is public and part of the portfolio. It must read well.

## Flow

```
issue → branch → worktree → implementation → checks → review → issue pull request
      → orchestrator squash-merges into the phase branch
                                  ...all issues of the phase...
phase branch → phase pull request → owner approval → merge into master
                                  → deployment and version (docs/release-workflow.md)
                                  → changelog pull request → owner merges
```

One issue, one branch, one worktree, one pull request. One phase, one integration branch, one pull request to `master`.

## Branches

| Branch                               | Purpose                                                      | Who merges into it                          |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------- |
| `master`                             | The only long-lived branch                                   | The owner only                              |
| `phase/<phase-folder>`               | Integration branch of a phase, for example `phase/02-api-db` | The orchestrator, after review and green CI |
| `<type>/<issue-number>-<short-slug>` | One issue, for example `feat/12-profile-experience-api`      | —                                           |

- `<type>` is a Conventional Commits type: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.
- An issue branch is cut from the phase branch and its pull request targets the phase branch.
- A sub-phase `NN.M-<name>` (`.plan/00-overview/prd.md`, Phases) is a phase in every respect: branch `phase/NN.M-<name>`, label `phase:NN.M-<name>`, its own phase pull request.
- Phase 0 (planning, docs, agent configuration and the harness) has no issues. It is done directly on `phase/00-overview` and reaches `master` through the same kind of phase pull request, after the trial has passed.
- The trial is the one phase whose base is not `master`: `phase/00-trial` is cut from `phase/00-overview`, and its phase pull request targets that branch and is closed without merging.
- Other work without an issue uses `<type>/<short-slug>`, for example `docs/fix-testing-guide`, and targets `master` through a pull request the owner merges.
- A number at the start of a slug means an issue number only on a branch cut from a phase branch. The worktree script continues an interrupted issue by that number ([repository structure](repository-structure.md#ports-and-worktree-isolation)); it never reads a phase branch, a branch cut from `master`, a name that starts with a phase folder (`docs/15-pages-prd`) or a zero-padded number that way.

### Why a phase branch

Issues of a phase depend on each other. The owner reviews at the end of a phase, not between issues, so finished work must be available to the next issue without waiting for a merge into `master`. The phase branch is where it accumulates.

## Worktrees

- Every issue branch is worked on in its own worktree under `.worktrees/`, created and removed with the scripts described in `docs/repository-structure.md`.
- App and package code is never edited in the main checkout. Planning files, docs and agent configuration may be.
- The main checkout may be behind `origin/master`. Run `git fetch origin`, then analyse and branch from `origin/<base>`, not from the files of the local checkout.
- The harness has 9 slots (`MAX_SLOTS`, `harness/lib/slots.mjs`), often all taken. A change that needs no database (documentation, CI, scripts) may use a plain worktree in an interactive session instead of a slot: `git worktree add .worktrees/<folder> -b <branch> origin/<base>`, never under `/tmp`. Name the folder as the harness would (`worktreeDirName`: slashes become `-`), or a later `worktree.mjs create` for that branch fails; plain worktrees do not show in `worktree.mjs list`. Run `pnpm install --frozen-lockfile` in it (the commit hook needs the tools) and never link `node_modules` from another checkout. Remove it with `git worktree remove` at the end of the session, and keep the branch. Anything that runs tests against a database uses a slot (`node harness/worktree.mjs create`); the phase loop always uses slots.
- **Cleanup after a merge.** The squash merge of an issue pull request deletes its remote branch (`--delete-branch`); the orchestrator removes its own issue worktree, storage folder, database and local branch, and the docs-keeper's worktree, at their documented steps (`.claude/agents/orchestrator.md`, steps 10 and 11). Everything else (other worktrees, branches, databases, another session's plain worktree) is removed only on the owner's instruction.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`. The scope is the app or package, for example `feat(api): add experience endpoints`.
- Summary in the imperative, lower case, no trailing period.
- The types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore` and `ci`; `!` before the colon marks a breaking change (`feat(api)!: drop the legacy profile route`). The scope is optional and in lower case. A body follows one blank line.
- Commits on an issue branch may be small and frequent; they are squashed when the issue is merged. Where test-first is mandatory, the test commit comes before the implementation commit so the reviewer can see the order.

### Local hooks

`pnpm install` enables the repository's Git hooks: the root `prepare` script (`harness/git-hooks/install.mjs`) sets `core.hooksPath` to `harness/git-hooks`. The path is relative, so Git resolves it in the worktree a commit is made in: every worktree runs the hooks it checked out, with its own installed tools, and one setting serves all worktrees of the repository. pnpm runs `prepare` only when it installs something; in a checkout that was installed before, run `pnpm run prepare`.

| Hook         | What it does                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | Formats the staged files with Prettier and lints the staged JavaScript and TypeScript files with ESLint, both with the shared configuration of the checkout. Any failure stops the commit and prints the tool output. |
| `commit-msg` | Checks the message against the rules above and stops the commit with what to change. Messages Git writes itself (`Merge …`, `Revert "…"`, `fixup!`, `squash!`, `amend!`) pass.                                        |

- **What is checked is what is committed.** A file whose working copy equals its staged content is formatted in place and staged again. A partially staged file is formatted from its staged content directly into the index; its working copy, with the unstaged edits, stays exactly as it was. Lint reads the staged content too. Other unstaged and untracked files are never touched.
- **Paths are data.** File names go to Git separated by NUL bytes and to the tools after `--` or as an option value, never through a shell or as a pattern, so spaces, brackets, a leading dash or non-ASCII characters are safe.
- **Fast by design.** The hooks do not run the typecheck or the tests; the [handoff checks](permissions.md#handoff-checks) and CI do. Without installed tools in the checkout the commit stops and names `pnpm install --frozen-lockfile`.
- **CI checks the formatting too.** A commit made without the hooks, or a file changed in the GitHub web editor, can skip `pre-commit`, so `pnpm check:format` (`scripts/checks/formatting.mjs`, part of `pnpm lint` and `pnpm ci:root`) runs Prettier in check mode over the same files: the working copy of every tracked regular file, with the checkout's configuration, `.prettierignore` (the lockfile, the generated migrations and API client, archived plans under `.plan/done/` and `CHANGELOG.md`) and `.gitignore`, skipping file types Prettier does not support. It changes nothing; a file it names is formatted with `pnpm exec prettier --write -- <file>` and committed.
- **No takeover.** If `core.hooksPath` already points elsewhere, the installer keeps it and says so. The one exception is the harness's own former path, `scripts/harness/git-hooks` (before [decision 0013](decisions/0013-harness-at-the-top-level.md)), which it moves to the current one. The phase loop does not change repository settings, so under `SEBELA_UNATTENDED=1` the installer only reports; the owner's one `pnpm install` in the main checkout enables the hooks for every worktree.
- A failing hook is fixed, not bypassed: do not commit with `--no-verify`.

### What CI validates

The `Commit messages` workflow (`.github/workflows/commit-messages.yml`, `scripts/checks/commit-messages.mjs`) applies the rules of the `commit-msg` hook, from the same module (`harness/lib/commit-message.mjs`), to what reaches GitHub. It runs on every pull request, again whenever a pull request's title is edited, and on pushes to `master` and `phase/**`.

| Event                                              | Commits checked                                 | Merge commits | `fixup!`, `squash!`, `amend!` | Title                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------- | ------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Issue pull request (head is not a `phase/` branch) | Base commit of the pull request to its head     | Pass          | Pass                          | Checked: it becomes the squash commit, so it must be a Conventional header itself — not a `Merge …` or autosquash header, one line |
| Phase pull request (head is a `phase/` branch)     | Base commit of the pull request to its head     | Pass          | Refused                       | Not checked: a phase is merged with a merge commit                                                                                 |
| Push to `master`                                   | The commit before the push to the pushed commit | Pass          | Refused                       | —                                                                                                                                  |

- **Test-first history passes.** Only the message is checked, never the tree of each commit, so a red test commit followed by its implementation is accepted; CI's other jobs check the head of the branch.
- **Autosquash markers are folded before they reach a shared branch.** On an issue branch the squash merge removes them; a phase branch and `master` keep every commit, so a `fixup!` there fails the check.
- **The phase merge commit.** GitHub's default header `Merge pull request #N from …` passes as a message Git writes; a custom header for that merge commit must be in Conventional form.
- `Revert "…"` passes everywhere.

## Issue pull requests

- Opened by the orchestrator against the phase branch once checks are green and the reviewer has approved.
- Title in Conventional Commits form — it becomes the squash commit message.
- Description, the sections of `.github/pull_request_template.md`, which pre-fills them for every pull request:

```
Closes #<issue>

## What changed
<two or three sentences>

## How it was tested
<tests, screenshots, evals>

## Docs updated
<documents changed with the behaviour, or "none needed" and why>

## Roles
Implemented by: <agent or person>
Reviewed by: <agent or person>
Approved by: <agent or person>
Orchestrated by: <agent>
```

- **Roles.** Every pull request names who implemented, who reviewed and who approved it (`AGENTS.md`, Git). For an issue pull request the approval is the reviewer agent's; for a pull request into `master` it is the owner's, written as `pending (owner)` until the owner approves. `Orchestrated by` is added only to issue pull requests that the orchestrator opens from the phase loop.
- A phase pull request also starts with a `## Summary` section: one paragraph on what the phase delivers.
- UI changes attach the screenshots at 360, 768 and 1280 px in both themes.
- A change in behaviour or structure includes the documentation update.
- Merged by the orchestrator with a **squash merge** when the reviewer has approved and CI is green on the pull request. The result is one commit per issue on the phase branch.
- `Closes #<issue>` only closes issues on merges into `master`, so after the merge the orchestrator closes the issue itself, with a comment naming the pull request, and deletes the local issue branch.

## Phase pull request

- Opened by the orchestrator from the phase branch to `master` **as a draft** when no ready issue of the phase remains; HITL issues may still be open.
- It **stays a draft until the owner switches it.** No agent marks a phase pull request ready, closes or reopens it — not the orchestrator in the loop, not an agent in an interactive session: the guard refuses `gh pr ready`, `gh pr close`, `gh pr reopen` and the same change through `gh api` for a pull request whose head is `phase/*`, and in an interactive main session asks the owner (`docs/permissions.md`, Denied).
- When the phase is complete, the owner marks it **ready for review**. That runs the paid model evals of the affected suites once on the final state — the one full paid run of the phase, paid from the phase campaign's reserve (`docs/testing.md`, Evals-driven development); a draft runs none. Only a phase pull request starts paid evals by itself: any other pull request into `master` starts none, and a change that really needs a suite gets a manual, charged run of the `Model evals` workflow (`docs/testing.md`, CI).
- It also moves the phase's plan folder `.plan/<phase>/` to `.plan/done/<phase>/` with `git mv` and updates every reference to the old path in the repository, so merging the phase into `master` archives its PRD and issue overview. The orchestrator does this once, on a short-lived branch merged into the phase branch, when it first opens the pull request; a phase already in `.plan/done/` is left there.
- The description starts with a `## Summary` section whose first paragraph says in plain words what the phase brings to the site; the release that deploys the phase quotes it as its highlight (`docs/release-workflow.md`, Versions). It then lists the issues of the phase with their pull requests, and anything skipped or failed.
- The owner reviews the phase as a whole and is the only one who merges it. It is merged with a **merge commit**, so `master` keeps one commit per issue plus one commit marking the phase.
- CI must be green on the phase branch.

## Changelog pull request

After every deployment that publishes a new version, the release workflow opens `chore(release): changelog for vX.Y.Z` from `changelog/vX.Y.Z` into `master`: it adds that version's release notes to `CHANGELOG.md` and nothing else (`docs/release-workflow.md`, Changelog). It is part of the normal flow after each release: the owner merges it with a squash merge once its checks are green, oldest version first when several are open. Merging it releases nothing. Nobody else edits `CHANGELOG.md` by hand.

## Dependency pull requests

Dependabot (`.github/dependabot.yml`) opens pull requests into `master` that update dependencies and nothing else. Their commit header, which is also the title and so the squash commit, passes the commit-message check.

| Entry                | What it updates                                                                                                     | When    | Pull requests (open at most)                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-actions`     | The pinned actions of `.github/workflows/`: the commit SHA and its version comment                                  | Monthly | One with every update, `ci: bump …` (2)                                                                                                                          |
| `npm`, `/infra/pnpm` | The hash-pinned pnpm of the container images (`infra/README.md`, pnpm in the images)                                | Monthly | `chore(deps): bump pnpm …`; it must also move `packageManager` in `package.json` before its checks pass (1)                                                      |
| `npm`, `/`           | The pnpm workspace: every member's `package.json`, the catalog and overrides of `pnpm-workspace.yaml`, the lockfile | Weekly  | One for all minor and patch updates, one for each major update, `chore(deps): …` or `chore(deps-dev): …` (5)                                                     |
| `docker`, `/apps/*`  | The base image of every app's Dockerfile, pinned by tag and digest; an update moves both                            | Weekly  | One for every base-image update of every Dockerfile, a new digest of the same tag included, `chore(deps): …` (2)                                                 |
| `uv`, `/`            | The uv workspace of the Python members: the exact versions in every member's `pyproject.toml`, and `uv.lock`        | Weekly  | One for all minor and patch updates, one for each major update and for each update of the client generator or Ruff, `chore(deps): …` or `chore(deps-dev): …` (5) |

- **Expected volume:** one to three pull requests a week (the npm group, often the uv group, now and then the Docker group or a major), plus the two monthly ones. The first runs bring the major updates that are already waiting, up to the limit.
- **Cooldown.** A new npm, Docker or Python package release is proposed once it is seven days old, so a broken or malicious release has time to be pulled first; the other entries keep Dependabot's default of three days. Security updates ignore the cooldown.
- **Not proposed.** Node.js majors (the `node` base image and `@types/node`): the Node.js version follows `.nvmrc` and `engines` in `package.json` and moves by hand, together with the images. The workspace entry leaves pnpm to the `/infra/pnpm` entry. The `uv` entry leaves out the build backend `uv_build`, which follows the uv version and moves by hand with it.
- **uv.** Dependabot updates `uv.lock` with its own uv, which is newer than the repository's (0.13.7 against 0.7.22 when the entry was added) and which an exact `required-version` would refuse, failing every run. `required-version` in the root `pyproject.toml` is therefore a lower bound, and the repository's uv is that bound: CI installs exactly it (`resolution-strategy: lowest` of the setup step) and `scripts/checks/uv-version.test.mjs` keeps the bound, the CI steps, the build backend and the documents in step. The trade-off: uv itself no longer refuses a newer uv on a developer's machine, only an older one. Dependabot's uv writes a higher `revision` into `uv.lock` in an otherwise unchanged format (checked with both versions on a copy of the workspace); the repository's uv reads such a lockfile and accepts it under `--locked`, which CI proves on every dependency pull request, and writes its own `revision` back the next time it changes the lockfile. A lockfile the repository's uv could not read would fail `uv sync --locked` in CI, and the pull request would not be merged. Moving the repository's uv means raising the bound, by hand ([Toolchain and workspace](repository-structure.md#toolchain-and-workspace)). Dependabot sorts updates by version segment, so the group also carries the minor updates of dependencies still at 0.x (`langsmith`, for example), which may be breaking; read the group's changelogs with that in mind. Two such tools are kept out of the group (`exclude-patterns`) and arrive in their own pull requests: `openapi-python-client`, because a new generator can change the generated content client and fail `pnpm check:api-client`, and `ruff`, because a new formatter or rule can fail `lint`. Either would turn the whole group red.
- **Not covered yet.** Images in the Compose files (the Postgres image of `compose.yaml`); they would need the separate `docker-compose` entry.
- **CI.** A dependency pull request runs CI like any other: the commit-message check, the root checks and the affected package tasks. A change of `pnpm-lock.yaml` selects the packages whose external dependencies changed, a change of `pnpm-workspace.yaml` (a catalog or override version) every package, a Dockerfile its app, and a change of `uv.lock` the Python package's tasks ([Affected packages](repository-structure.md#affected-packages)). It gets no repository Actions secrets: the private-terms check reports that it was skipped, and it starts no paid eval suite, like every pull request that is not a phase pull request (`docs/testing.md`, CI): `Affected eval suites` ends green and the suites' jobs are skipped, also for an update of MCP Admin's or the API client's locked dependencies, or of the Python agent's (`uv.lock`). The owner decides whether such an update needs a manual, charged run of the `Model evals` workflow before merging: the `mcp-admin` suite for the former, the `llm-agent` suite for a uv update that can change the chat agent's behaviour (`anthropic`, `langchain-*`, `langgraph`).
- **Who merges.** The owner reviews and merges every dependency pull request, with a squash merge once its checks are green. Agents do not merge them. When an update needs more than Dependabot changed (the pnpm pull request, a major update with breaking changes), the follow-up commit goes onto the same branch, or the pull request is closed and the work is done in an issue; `@dependabot ignore` comments stop a version or dependency from being proposed again.

## Rules that never bend

- Nobody but the owner merges into `master`. Nobody pushes to `master` directly.
- Nobody force-pushes a shared branch (`master`, a phase branch).
- A failing check is fixed, not bypassed.

## What stays out of the history

No `fix`, `fix2`, `try again` on `master`. Each commit there is one issue with one meaningful message.

## The phase loop

A phase can be processed unattended. See `docs/agents.md`.
