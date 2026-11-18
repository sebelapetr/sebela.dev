# Phase 5 — Issues

Source: [MCP Admin PRD](prd.md). The owner approved direct publication of this five-slice breakdown in conversation, using the repository-local [to-issues skill](../../.claude/skills/to-issues/SKILL.md).

Published on 2026-11-18: **5 issues, 3 AFK and 2 HITL**. Labels are `phase:05-mcp-admin`, `afk`/`hitl` and `ready-for-agent`; labels do not waive dependencies or HITL gates. No MCP implementation, real-model eval or phase loop was started by this publication.

Acceptance specifications: [24 deterministic security families](security.md) and [32 Czech/English model cases](evals.md). These describe future tests/evals, not measured results.

## Prerequisites

API/database phase 2, website phase 3 and planning PR #134 are owner-merged. Phase 4 must complete, including [handoff #115](https://github.com/sebelapetr/sebela.dev/issues/115), and its phase PR must be owner-merged before phase-5 implementation. The planning PR containing these issue/eval/security documents must also be owner-merged before cutting `phase/05-mcp-admin`. Closed issues alone do not establish those merges.

## Published breakdown

| Slice | Issue                                                       | Title                                                                       | Type | Blocked by                                                                                                               | Phase-5 stories               |
| ----- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| S01   | [#153](https://github.com/sebelapetr/sebela.dev/issues/153) | Connect a private authenticated MCP Admin using the official SDK and Hono   | HITL | Phase 4 owner-merged; [#115](https://github.com/sebelapetr/sebela.dev/issues/115); planning documents owner-merged       | 15–20, 24–26                  |
| S02   | [#154](https://github.com/sebelapetr/sebela.dev/issues/154) | Manage all content through constrained MCP tools and atomic API audit       | AFK  | [#153](https://github.com/sebelapetr/sebela.dev/issues/153)                                                              | 7, 9–14, 17, 19–25            |
| S03   | [#155](https://github.com/sebelapetr/sebela.dev/issues/155) | Record learning sessions resources books and events through task tools      | AFK  | [#154](https://github.com/sebelapetr/sebela.dev/issues/154)                                                              | 1–6, 11, 13–14, 19, 21, 23–25 |
| S04   | [#156](https://github.com/sebelapetr/sebela.dev/issues/156) | Upload and attach media through the profile and CV maintenance flow         | AFK  | [#154](https://github.com/sebelapetr/sebela.dev/issues/154)                                                              | 7–11, 14, 21, 23–25           |
| S05   | [#157](https://github.com/sebelapetr/sebela.dev/issues/157) | Accept complete MCP administration with the owner client and security gates | HITL | [#155](https://github.com/sebelapetr/sebela.dev/issues/155), [#156](https://github.com/sebelapetr/sebela.dev/issues/156) | 11–12, 14–18, 22–26           |

## Scope ownership

- **S01** delivers the secure read path using official MCP SDK + Hono, reuses Bearer/API-key verification and establishes the external-client evaluation harness. It does not rebuild API-key generation or the API. Exact SDK/client/model settings and baseline gates are verified with the owner during this HITL issue.
- **S02** delivers the complete generic content registry, profile-update skill, one-record deletion and atomic API-owned audit across profile/learning/media mutations. Reuse the generated API client; no tool per endpoint, arbitrary SQL/HTTP or raw operational-table access. Model restraint does not replace authorization/client approval.
- **S03** delivers resource find/add/status, one complete session operation, events/books and diary-entry/add-event skills. API owns calendar/overlap/derived rules and atomic session/audit writes. Do not reimplement generic CRUD/audit or duplicate book time accounting.
- **S04** delivers bounded upload/attachment and update-cv, extending the profile skill rather than duplicating it. Reuse existing storage/media validation. No visitor upload, generated CV or RAG ingest is introduced.
- **S05** is the owner's complete connected workflow, actual destructive approval/decline, all skills and integrated security/eval acceptance. Security/test work belongs to each earlier functional slice; this gate verifies completeness rather than postponing it.

## Shared acceptance and execution rules

- Every slice owns the necessary complete path: MCP tool/skill -> generated client -> API -> cohesive service/persistence -> audit/invalidation -> tests/evals and documentation. No separate schema-only, API-only or test-only issues.
- Security/API/domain behaviour is test-first. Model-dependent behaviour is evals-first. Use fictional fixtures, disposable databases, redacted reports and declared model limits. Every applicable deterministic/safety case must pass; unfinished cases remain visibly pending.
- Ordinary CI uses fakes; paid evaluation runs are explicitly budgeted/on demand. No production Python agent, AI-service, RAG, graph, ontology, external MCP UI or admin UI is part of this phase.
- Keep the small deep-module layout and explicit entries, not a service/framework per tool or entity. MCP imports contracts/client/config only, never db/services. Audit belongs to backend transactions; the post-write invalidation callback is not authoritative audit.
- No automatic retry after a possibly committed write. Reconcile through reads/audit or return uncertainty. A confirmed partial outcome of separate actions is reported honestly, never hidden by compensating deletions.
- Every new API mutation updates generated clients, consumer tests and the route-walking auth/audit coverage; security cannot be deferred to S05.
- Current execution is sequential. S03 and S04 share registry/contracts/generated clients/media/audit/seed or migration exports despite independent dependency edges. Serialize them or assign explicit disjoint file ownership before parallel work; never generate competing clients/migrations.

## Running the phase

After prerequisite merges, complete **S01 interactively** and record the actual connection/baseline acceptance. The phase loop skips HITL issues, so publication/`ready-for-agent` is not permission to bypass that gate. Only then does the owner start the AFK segment:

```bash
harness/run-phase.sh 05-mcp-admin
```

Finish **S05 interactively** after S02–S04. A no-eligible-issues/phase-done report alone cannot accept an open HITL gate or failed safety case. Issue branches/PRs target `phase/05-mcp-admin`; the orchestrator may squash-merge reviewed green issue PRs there. Only the owner merges the phase PR into `master`. No loop/implementation was launched by planning publication.
