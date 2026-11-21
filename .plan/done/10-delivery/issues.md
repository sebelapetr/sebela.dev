# Phase 10 — Issues

Source: [Continuous delivery PRD](prd.md). The owner approved the PRD and this six-issue breakdown, and its immediate GitHub publication, on 2026-11-20.

Published on 2026-11-20: **6 issues, 4 AFK and 2 HITL**. All carry `phase:10-delivery`, `ready-for-agent` and exactly one of `afk`/`hitl`.

## Scheduling

Phase 10 depends on what `master` holds (phases 1–5). The PR publishing this file must be owner-merged before `phase/10-delivery` is cut. It runs in a third loop (`phase-10`) alongside phases 6/7 and 9.

## Published breakdown

| Slice | Issue                                                       | Title                                                                              | Type | Blocked by                                                  | Stories               |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- | --------------------- |
| S01   | [#232](https://github.com/sebelapetr/sebela.dev/issues/232) | Run the production stack of the website, API and admin MCP from images             | AFK  | None                                                        | 11, 13, 14, 16–18     |
| S02   | [#233](https://github.com/sebelapetr/sebela.dev/issues/233) | Build, verify and publish only the affected images after a merge into master       | AFK  | [#232](https://github.com/sebelapetr/sebela.dev/issues/232) | 2, 3, 18              |
| S03   | [#234](https://github.com/sebelapetr/sebela.dev/issues/234) | Deploy verified images to the VPS with automatic rollback and a release            | AFK  | [#233](https://github.com/sebelapetr/sebela.dev/issues/233) | 1, 4–6, 9, 12, 15, 17 |
| S04   | [#235](https://github.com/sebelapetr/sebela.dev/issues/235) | Back up encrypted off the server, rehearse restore and clear the demo content      | AFK  | [#234](https://github.com/sebelapetr/sebela.dev/issues/234) | 7, 8, 10, 15, 18      |
| S05   | [#236](https://github.com/sebelapetr/sebela.dev/issues/236) | Prepare the server and accounts for the first deployment                           | HITL | [#235](https://github.com/sebelapetr/sebela.dev/issues/235) | Server preparation    |
| S06   | [#237](https://github.com/sebelapetr/sebela.dev/issues/237) | Accept phase 10 with the first deployment, a rollback test and a restore rehearsal | HITL | [#236](https://github.com/sebelapetr/sebela.dev/issues/236) | Acceptance; all       |

## Notes

- The chain is sequential: the slices share `infra/`, the workflows and the production composition.
- S05 happens before the phase pull request is merged (the deploy workflow only runs from `master`); S06 after it, and closing S06 accepts the phase.
- Delivery issues for phases 7, 8 and 9/9.1 are created after this phase is merged; the launch is the last HITL issue of phase 9.1.
- Images are verified in CI; the loop avoids local image builds because the server's system disk is small.
