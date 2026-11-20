# Phase 1 — Issues

Source: [Foundation PRD](prd.md). The owner approved the PRD and the seven-issue breakdown in conversation.

Published on 2026-11-15. All issues are AFK and carry `phase:01-foundation`, `afk` and `ready-for-agent`. Blocked issues become eligible only after their blockers close.

Prerequisite: phase 0 must be merged into `master`, including the passed trial and its harness fixes, before this phase starts.

| Issue                                                     | Title                                                           | Type | Blocked by                                                                                                                                                                                                                                 | Phase 1 user stories |
| --------------------------------------------------------- | --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| [#15](https://github.com/sebelapetr/sebela.dev/issues/15) | Bootstrap the monorepo with shared tooling and passing CI       | AFK  | None                                                                                                                                                                                                                                       | 1, 2, 10             |
| [#16](https://github.com/sebelapetr/sebela.dev/issues/16) | Enforce repository import boundaries through lint               | AFK  | [#15](https://github.com/sebelapetr/sebela.dev/issues/15)                                                                                                                                                                                  | 8                    |
| [#17](https://github.com/sebelapetr/sebela.dev/issues/17) | Reject hard-coded runtime endpoints and database names          | AFK  | [#15](https://github.com/sebelapetr/sebela.dev/issues/15)                                                                                                                                                                                  | 9                    |
| [#18](https://github.com/sebelapetr/sebela.dev/issues/18) | Start Postgres and isolate each worktree in its own database    | AFK  | [#15](https://github.com/sebelapetr/sebela.dev/issues/15), [#17](https://github.com/sebelapetr/sebela.dev/issues/17)                                                                                                                       | 1, 4, 5              |
| [#19](https://github.com/sebelapetr/sebela.dev/issues/19) | Apply formatting and quality checks at developer handoffs       | AFK  | [#15](https://github.com/sebelapetr/sebela.dev/issues/15), [#16](https://github.com/sebelapetr/sebela.dev/issues/16), [#17](https://github.com/sebelapetr/sebela.dev/issues/17)                                                            | 3, 6, 7, 10          |
| [#20](https://github.com/sebelapetr/sebela.dev/issues/20) | Gate pull requests with the complete affected-task pipeline     | AFK  | [#16](https://github.com/sebelapetr/sebela.dev/issues/16), [#17](https://github.com/sebelapetr/sebela.dev/issues/17), [#18](https://github.com/sebelapetr/sebela.dev/issues/18), [#19](https://github.com/sebelapetr/sebela.dev/issues/19) | 2, 3                 |
| [#21](https://github.com/sebelapetr/sebela.dev/issues/21) | Document and verify the contributor setup from a clean checkout | AFK  | [#20](https://github.com/sebelapetr/sebela.dev/issues/20)                                                                                                                                                                                  | 1, 11, 12            |

## Execution notes

- Each issue delivers an executable workflow or a check that can be demonstrated independently. Phase 1 creates only the shared configuration package; no application, domain package, empty app or demo feature is added to provide a test target.
- The loop remains sequential. [#16](https://github.com/sebelapetr/sebela.dev/issues/16) and [#17](https://github.com/sebelapetr/sebela.dev/issues/17) both extend shared tooling and root commands and must not be implemented in parallel without separating their edits. [#18](https://github.com/sebelapetr/sebela.dev/issues/18) and [#19](https://github.com/sebelapetr/sebela.dev/issues/19) may overlap in harness integration and documentation; this breakdown does not authorise concurrent edits there either.
- Implement foundation tooling with the backend developer; these issues explicitly include the infrastructure and harness changes outside its usual application area. The reviewer checks the full issue, and the docs-keeper follows each merge.
- Keep the dependency-free harness on plain Node and its built-in test runner. New application-tooling dependencies must be justified in the pull request.
- Read configuration through the process environment or an authorised runtime loader. Agents may read and edit `.env.local` only inside their assigned worktree, with the session running there, as permitted by the current root `AGENTS.md`; other environment files and the main checkout's environment files remain off limits. Use `.env.example` and command results where direct access is unnecessary.
- A new behaviour or structure is documented in its own issue pull request. [#21](https://github.com/sebelapetr/sebela.dev/issues/21) verifies onboarding and updates the README; it is not a reason to defer earlier documentation updates.
- No UI or AI work is included, so screenshots and model evals are not acceptance requirements for these issues.

## Running the phase

After phase 0 is merged and the main checkout is up to date, the owner starts:

```bash
scripts/run-phase.sh 01-foundation
```

The loop creates `phase/01-foundation` from `master`, processes eligible issues sequentially and opens the phase pull request for the owner. A phase report can still include failed, blocked or skipped issues; review those before merging into `master`.
