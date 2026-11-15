# Phase 2 — Issues

Source: [API and database PRD](prd.md). The owner approved the PRD and the twenty-issue breakdown in conversation, including the module convention, security requirements and CV exploration clarification.

Published on 2026-11-15. All issues are AFK and carry `phase:02-api-db`, `afk` and `ready-for-agent`. Blocked issues become eligible only after their blockers close.

Prerequisite: phase 1 must be complete and owner-merged into `master` before implementation starts. Closing [phase 1 issues](../01-foundation/issues.md) alone does not prove that merge happened.

| Issue | Title | Type | Blocked by | Phase 2 user stories |
| --- | --- | --- | --- | --- |
| [#22](https://github.com/sebelapetr/sebela.dev/issues/22) | Establish the deep-module standard and enforce module imports | AFK | Phase 1 complete and owner-merged into master | 31, 32 |
| [#23](https://github.com/sebelapetr/sebela.dev/issues/23) | Manage the person profile through a secured API with API-key CLI | AFK | [#22](https://github.com/sebelapetr/sebela.dev/issues/22) | 1, 12, 13, 16, 17, 18, 19, 20, 24, 31 |
| [#24](https://github.com/sebelapetr/sebela.dev/issues/24) | Consume the API through a generated client and prevent contract drift | AFK | [#23](https://github.com/sebelapetr/sebela.dev/issues/23) | 20, 21, 22, 23, 24, 31 |
| [#25](https://github.com/sebelapetr/sebela.dev/issues/25) | Manage ordered technology and topic catalogs through the API | AFK | [#24](https://github.com/sebelapetr/sebela.dev/issues/24) | 7, 11, 12, 13, 16, 17, 18, 20, 21, 23 |
| [#26](https://github.com/sebelapetr/sebela.dev/issues/26) | Manage organizations and expose their public profile records | AFK | [#24](https://github.com/sebelapetr/sebela.dev/issues/24) | 2, 11, 12, 13, 16, 17, 18 |
| [#27](https://github.com/sebelapetr/sebela.dev/issues/27) | Manage experiences with organization and technology relations atomically | AFK | [#25](https://github.com/sebelapetr/sebela.dev/issues/25), [#26](https://github.com/sebelapetr/sebela.dev/issues/26) | 2, 3, 8, 11, 12, 13, 14, 16, 17, 18 |
| [#28](https://github.com/sebelapetr/sebela.dev/issues/28) | Manage projects inside their owning experience | AFK | [#27](https://github.com/sebelapetr/sebela.dev/issues/27) | 3, 4, 11, 12, 13, 14, 16, 17, 18 |
| [#29](https://github.com/sebelapetr/sebela.dev/issues/29) | Manage a project's case study and read it with the project | AFK | [#28](https://github.com/sebelapetr/sebela.dev/issues/28) | 4, 12, 13, 16, 17, 18 |
| [#30](https://github.com/sebelapetr/sebela.dev/issues/30) | Manage explorations with honest status and concept relations | AFK | [#25](https://github.com/sebelapetr/sebela.dev/issues/25) | 5, 11, 12, 13, 14, 16, 17, 18 |
| [#31](https://github.com/sebelapetr/sebela.dev/issues/31) | Manage services with project, exploration and link evidence | AFK | [#28](https://github.com/sebelapetr/sebela.dev/issues/28), [#30](https://github.com/sebelapetr/sebela.dev/issues/30) | 6, 11, 12, 13, 14, 16, 17, 18 |
| [#32](https://github.com/sebelapetr/sebela.dev/issues/32) | Manage education and learning milestones as ordered profile records | AFK | [#24](https://github.com/sebelapetr/sebela.dev/issues/24) | 8, 11, 12, 13, 16, 17, 18 |
| [#33](https://github.com/sebelapetr/sebela.dev/issues/33) | Manage testimonials attached to their experience | AFK | [#27](https://github.com/sebelapetr/sebela.dev/issues/27) | 8, 11, 12, 13, 14, 16, 17, 18 |
| [#34](https://github.com/sebelapetr/sebela.dev/issues/34) | Manage the current focus with optional project and topics | AFK | [#28](https://github.com/sebelapetr/sebela.dev/issues/28) | 8, 11, 12, 13, 14, 16, 17, 18 |
| [#35](https://github.com/sebelapetr/sebela.dev/issues/35) | Upload and attach local images and CV PDFs safely | AFK | [#28](https://github.com/sebelapetr/sebela.dev/issues/28) | 1, 3, 10, 12, 13, 14, 15, 16, 18, 29 |
| [#36](https://github.com/sebelapetr/sebela.dev/issues/36) | Use Bunny S3 storage through the same media workflow | AFK | [#35](https://github.com/sebelapetr/sebela.dev/issues/35) | 10, 15, 29, 30 |
| [#37](https://github.com/sebelapetr/sebela.dev/issues/37) | Assemble print-friendly CV data including concise explorations | AFK | [#30](https://github.com/sebelapetr/sebela.dev/issues/30), [#32](https://github.com/sebelapetr/sebela.dev/issues/32), [#35](https://github.com/sebelapetr/sebela.dev/issues/35) | 9, 11, 12, 20, 21, 23 |
| [#38](https://github.com/sebelapetr/sebela.dev/issues/38) | Load a complete fictional profile seed idempotently | AFK | [#29](https://github.com/sebelapetr/sebela.dev/issues/29), [#31](https://github.com/sebelapetr/sebela.dev/issues/31), [#33](https://github.com/sebelapetr/sebela.dev/issues/33), [#34](https://github.com/sebelapetr/sebela.dev/issues/34), [#37](https://github.com/sebelapetr/sebela.dev/issues/37) | 25, 26, 27, 31 |
| [#39](https://github.com/sebelapetr/sebela.dev/issues/39) | Start the seeded API stack with a dedicated migration service | AFK | [#38](https://github.com/sebelapetr/sebela.dev/issues/38) | 20, 24, 28, 29, 31 |
| [#40](https://github.com/sebelapetr/sebela.dev/issues/40) | Prepare and clean migrated seeded worktrees with isolated storage | AFK | [#36](https://github.com/sebelapetr/sebela.dev/issues/36), [#38](https://github.com/sebelapetr/sebela.dev/issues/38) | 28, 29, 30, 31 |
| [#41](https://github.com/sebelapetr/sebela.dev/issues/41) | Verify the complete backend handoff from a clean checkout | AFK | [#39](https://github.com/sebelapetr/sebela.dev/issues/39), [#40](https://github.com/sebelapetr/sebela.dev/issues/40) | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32 |

## Execution notes

- The owner brought forward the deep-module rationale, layout/import documentation, root/role instructions, always-loaded Claude rule and project-local codebase-design/TDD references into [PR #62](https://github.com/sebelapetr/sebela.dev/pull/62). [#22](https://github.com/sebelapetr/sebela.dev/issues/22) remains open: it verifies that inherited standard and delivers the fixture-based private-import/cycle checks after phase 1. This documentation work does not close the issue or remove its blocker role.
- [#22](https://github.com/sebelapetr/sebela.dev/issues/22) is the separately requested standard/enforcement issue; its fixture-driven check and instructions are independently verifiable without empty app scaffolding. [#23](https://github.com/sebelapetr/sebela.dev/issues/23) is the first application tracer bullet and is deliberately wider: key CLI and security must exist before subsequent content writes. It introduces only the packages required for that real person-profile workflow.
- [#24](https://github.com/sebelapetr/sebela.dev/issues/24) delivers an executable contract-consumer workflow. [#25](https://github.com/sebelapetr/sebela.dev/issues/25)–[#35](https://github.com/sebelapetr/sebela.dev/issues/35) and [#37](https://github.com/sebelapetr/sebela.dev/issues/37) each include persistence, services, HTTP, contracts/client updates and tests for their complete resource/use case. [#36](https://github.com/sebelapetr/sebela.dev/issues/36) delivers the existing media workflow on another driver. [#38](https://github.com/sebelapetr/sebela.dev/issues/38)–[#40](https://github.com/sebelapetr/sebela.dev/issues/40) deliver executable bootstrap/runtime/isolation workflows.
- Every resource has public read and protected create/update/delete contracts; singleton and project-owned resources have explicitly documented addressing. Ordering, common errors, stable slugs where applicable, relation atomicity and deletion restrictions travel with each owning resource.
- The loop is sequential. Independence in the blocker graph does not authorize parallel edits: resource slices share profile schema/registration, package entries, contracts, generated output, migration metadata and docs. [#39](https://github.com/sebelapetr/sebela.dev/issues/39)/[#40](https://github.com/sebelapetr/sebela.dev/issues/40) also overlap root commands, example configuration and lifecycle documentation. Separate these files or coordinate rebasing before any future parallel run; never generate competing migration snapshots concurrently.
- [#23](https://github.com/sebelapetr/sebela.dev/issues/23) makes backend CI/security checks meaningful immediately; [#24](https://github.com/sebelapetr/sebela.dev/issues/24) adds client drift prevention and later slices extend them. [#41](https://github.com/sebelapetr/sebela.dev/issues/41) verifies the final handoff and cannot be used to defer documentation, tests or checks from earlier issues.
- Application/package/agent-rule changes follow the worktree workflow. Scoped development configuration access follows the current root AGENTS.md, superseding old planning notes that categorically prohibited generated development environment files. No production credential or private owner-content access is authorized.
- The seed's location in db does not authorize db to import services/contracts. Its runnable backend orchestration uses services from the permitted composition side; db remains persistence-only, with the fictional seed data in its approved location.
- CV exploration inclusion was clarified with the owner while drafting. Explorations remain separate from career experiences; the data preserves all statuses and phase 3 controls presentation. The API does not generate PDFs.
- Shared criteria apply to all bodies; fixture-only [#22](https://github.com/sebelapetr/sebela.dev/issues/22) uses the phase 1 toolchain without requiring nonexistent backend build targets. No frontend, MCP, retrieval, chat, real private-seed conversion, cloud-zone provisioning or production deployment is added.

Production Bunny zone provisioning and preparing/loading the owner’s real seed are outside unattended phase 2 work. The Bunny driver and its normal CI verification require no cloud credentials.

## Running the phase

After phase 1 is merged and the main checkout is up to date, the owner starts:

```bash
scripts/run-phase.sh 02-api-db
```

The loop creates `phase/02-api-db` from `master`, processes eligible issues sequentially and opens the phase pull request for the owner. The orchestrator may merge reviewed issue pull requests into the phase branch; only the owner merges the phase into `master`. Review failed, blocked or skipped issues even if the loop reports that no eligible issue remains.
