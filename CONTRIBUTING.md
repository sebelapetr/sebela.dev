# Contributing

sebela.dev is a personal project, built in the open as part of a portfolio. This page explains how the repository is built and how you can help. The rules themselves live in the binding documents linked below; this page does not repeat them.

## How the repository is built

The code is written by the owner together with coding agents. The owner decides what gets built and reviews every phase; agents implement, review each other's work and keep the documentation in step, within rules the [harness](harness/README.md) enforces.

### Phases and issues

Work is planned in **phases**. Each phase has a product specification (PRD) in [`.plan/`](.plan/00-overview/prd.md); finished phases are archived in `.plan/done/`. A phase is broken into GitHub issues, each a thin vertical slice with acceptance criteria. On GitHub a release is a **milestone**; each phase has one **tracking issue** in it, and the phase's issues are that issue's **sub-issues**, in the order they are worked on, with native blocked-by links for what must come first. Small issues that belong to no phase sit in the milestone directly. Labels only say who may take an issue: `ready-for-agent` (approved for agents), `hitl` (needs the owner: a decision or a design review) and `afk` (agents can finish it alone).

### One issue, one branch, one worktree, one pull request

```text
issue → branch + worktree → implementation → checks → reviewer agent
      → issue pull request → squash merge into phase/<phase-folder>

all issues of the phase → phase pull request → owner review → merge into master
```

- Each issue is implemented on its own branch in its own Git worktree under `.worktrees/`, created by `node harness/worktree.mjs create <branch>`. A worktree gets its own ports, its own database and database role, and its own storage folder, so several issues can run side by side without touching each other's data.
- A reviewer agent checks the branch against the issue and the repository rules before a pull request is opened. The orchestrator agent squash-merges reviewed issue pull requests into the phase branch.
- The phase pull request into `master` is reviewed and **merged only by the owner**. Nobody pushes to `master`.

The owner can run a whole phase unattended with `harness/run-phase.sh <phase-folder>`: a loop that takes one issue at a time — the first sub-issue of the phase's tracking issue that is ready and not blocked — each with a fresh agent, and skips issues that need a human. Hooks keep the agents inside the rules: a guard refuses forbidden actions, edited files are formatted, and a handoff is refused while lint or typecheck fail.

Details: [git workflow](docs/git-workflow.md), [agents](docs/agents.md), [permissions](docs/permissions.md), [harness](harness/README.md).

### Tests first, evals first

- **Test-first** for security, API contracts, services, domain logic and bug fixes: the failing test is committed before the code that makes it pass.
- **Evals-first** for MCP and AI behaviour: evaluation cases with a stated pass threshold come before the implementation. Safety suites must pass completely, and thresholds are never lowered to make a run pass.
- **Visual evidence** for the website: browser checks and screenshots at 360, 768 and 1280 px in light and dark mode.

Details: [testing](docs/testing.md).

### Commits and hooks

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(api): add experience endpoints`). `pnpm install` enables the Git hooks: staged files are formatted and linted, and the commit message is checked. CI checks the same rules again. A failing hook or check is fixed, never bypassed.

### Rules that hold everywhere

- **The API is the trust boundary.** Only the API reaches the database; everything else talks to it over HTTP ([architecture](docs/architecture.md)).
- **No real personal data in the repository.** It holds only the fictional demo seed and fictional test fixtures.
- **Nothing environment-specific is hard-coded.** Ports, hosts and database names come from the environment.
- **Docs are binding.** A change in behaviour updates its document in the same pull request.

The full list is in [AGENTS.md](AGENTS.md), which every agent, and every human contributor, reads first.

## How you can help

- **Report a bug or suggest an idea** by [opening an issue](https://github.com/sebelapetr/sebela.dev/issues/new/choose). The templates ask for what is needed.
- **Ask a question or discuss** the architecture, the agent workflow or anything else in [Discussions](https://github.com/sebelapetr/sebela.dev/discussions).
- **Report a security vulnerability privately**, never in an issue. See [SECURITY.md](SECURITY.md).
- **Send a pull request for a small fix**, such as a typo, a broken link, a documentation mistake or a small, well-understood bug. For anything larger, open an issue first, since work is planned in phases and the change may already be scheduled or conflict with one.

### Pull requests

1. Fork the repository and create a branch named `<type>/<short-slug>`, for example `docs/fix-readme-link`.
2. Set up the project as described in the [README](README.md#working-on-the-project): Node.js and pnpm versions are pinned, and `pnpm install --frozen-lockfile` also enables the hooks.
3. Make the change with a test where the rules above require one, and update the documentation it affects.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, or the narrower commands in [AGENTS.md](AGENTS.md#commands) for what you changed.
5. Open a pull request into `master` with a Conventional Commits title. The [pull request template](.github/pull_request_template.md) lists what to include.

CI runs the same checks on your pull request; the owner reviews and merges it. The paid model evals start by themselves only on the owner's phase pull requests, so they do not run on your pull request; the owner runs them by hand where a change needs it.

## License

By contributing you agree that your contribution is licensed under the [MIT license](LICENSE) of the code. The owner's personal content, photographs and branding are not part of the repository and are not covered by it.
