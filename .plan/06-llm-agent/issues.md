# Phase 6 — Issues

Source: [Reusable LLM agent PRD](prd.md) and [evaluation specification](evals.md), approved and owner-merged in [PR #176](https://github.com/sebelapetr/sebela.dev/pull/176). The owner explicitly approved immediate issue publication in conversation on 2026-11-19, using the repository-local [to-issues skill](../../.claude/skills/to-issues/SKILL.md); no separate draft-approval round was requested.

Published on 2026-11-19: **6 issues, 5 AFK and 1 HITL**. All carry `phase:06-llm-agent`, their `afk`/`hitl` type and `ready-for-agent`. Readiness does not waive dependencies, owner merges or the final human acceptance gate. Publication starts no implementation, paid eval or phase loop.

## Prerequisites

Phases 2 and 4, including [roadmap handoff #115](https://github.com/sebelapetr/sebela.dev/issues/115), must be complete and owner-merged. Phase 5 must finish [owner acceptance #157](https://github.com/sebelapetr/sebela.dev/issues/157) and its phase PR (currently [#175](https://github.com/sebelapetr/sebela.dev/pull/175)) must be owner-merged into `master`. The PR publishing this issue index must also be owner-merged before cutting `phase/06-llm-agent`. A closed issue alone is not proof of a merge. Phase 5 is still running at publication; creating these issues does not start phase 6.

## Published breakdown

| Slice | Issue                                                       | Title                                                                          | Type | Blocked by                                                                                                 | Phase-6 stories |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| S01   | [#178](https://github.com/sebelapetr/sebela.dev/issues/178) | Run a guarded bilingual profile answer through the local Python agent          | AFK  | [#157](https://github.com/sebelapetr/sebela.dev/issues/157); phase 5 and issue-publication PR owner-merged | 1–6             |
| S02   | [#179](https://github.com/sebelapetr/sebela.dev/issues/179) | Answer career and role-fit questions from source-backed portfolio tools        | AFK  | [#178](https://github.com/sebelapetr/sebela.dev/issues/178)                                                | 2–6             |
| S03   | [#180](https://github.com/sebelapetr/sebela.dev/issues/180) | Answer learning and current-focus questions from the roadmap API               | AFK  | [#179](https://github.com/sebelapetr/sebela.dev/issues/179)                                                | 2–4, 6          |
| S04   | [#181](https://github.com/sebelapetr/sebela.dev/issues/181) | Continue bilingual conversations within bounded async execution limits         | AFK  | [#180](https://github.com/sebelapetr/sebela.dev/issues/180)                                                | 1–6             |
| S05   | [#182](https://github.com/sebelapetr/sebela.dev/issues/182) | Resist direct and indirect injection while keeping legitimate questions usable | AFK  | [#181](https://github.com/sebelapetr/sebela.dev/issues/181)                                                | 2–6             |
| S06   | [#183](https://github.com/sebelapetr/sebela.dev/issues/183) | Accept the agent model and bilingual quality gates with recorded human grades  | HITL | [#182](https://github.com/sebelapetr/sebela.dev/issues/182)                                                | 1–6             |

## Scope and scenario ownership

Each functional slice delivers the whole narrow path that exists in phase 6: local runner -> Security -> Main with allowlisted public API reads -> deterministic Output -> typed approved response, with contract tests, applicable evals, usage and documentation. There is no separate scaffold-only, tools-only, tests-only or security-later issue. The approved file map guides the implementation; it is not empty scaffolding to create in advance.

- **S01 / #178:** a complete English/Czech profile/contact/unknown/refusal path; Python toolchain/package setup; generated content client and drift checks; guarded async pipeline; scoped evals and saved answers; step-scoped secret wrapper; Python workflow integration and real test-API prerequisites. The automated baseline has no owner manual-approval prerequisite for S02.
- **S02 / #179:** career, project/case-study, service, technology, education and exploration reads; sourced blocks, truthful status and role-fit inference; missing facts, invented qualifications and fabricated citations handled safely.
- **S03 / #180:** current focus, roadmap, diary/statistics, books and events; use the API's progress, calendar and time semantics, preserving the distinction between learning and professional expertise.
- **S04 / #181:** bounded follow-up history and language switching; conformance for deadlines/tokens/cost/retries, async isolation/cancellation, honest failure outcomes and redacted telemetry. Initial capabilities already enforce their applicable limits; this issue adds the complete conformance journeys.
- **S05 / #182:** direct/indirect injection, fake authority/roles, synthetic-secret and destination attacks, plus legitimate portfolio technical/security questions. Complete all planned cases and prepare evidence/samples for human review. Existing protections are extended, not deferred until this issue.
- **S06 / #183:** bounded reference-model comparison, selected configuration, complete phase-PR gates, model-grader calibration and the owner's 12 recorded answer scores (6 EN / 6 CS) plus disputed/ambiguous cases; package handoff to phase 7. Final PR approval accepts the linked review record and cannot waive a failing critical check.

| Owner                                                             | Newly implemented paired families                                         | EN/CS case count |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| S01 / [#178](https://github.com/sebelapetr/sebela.dev/issues/178) | Q01, Q14, S01, S08, S11, S19                                              | 12               |
| S02 / [#179](https://github.com/sebelapetr/sebela.dev/issues/179) | Q02, Q03, Q04, Q05, Q06, Q07, Q15, Q16, S02, S03, S04, S06, S07, S10, S20 | 30               |
| S03 / [#180](https://github.com/sebelapetr/sebela.dev/issues/180) | Q08, Q09, Q10, Q11, Q12, Q13, S05                                         | 14               |
| S04 / [#181](https://github.com/sebelapetr/sebela.dev/issues/181) | Q17, Q18, S17                                                             | 6                |
| S05 / [#182](https://github.com/sebelapetr/sebela.dev/issues/182) | Q19, Q20, S09, S12, S13, S14, S15, S16, S18                               | 18               |

The 40 unique families give 80 end-to-end cases. Each case is implemented before its behaviour, with explicit expectations; this index is not an executable dataset or a baseline result. An owning slice also reruns any other implemented cases affected by shared changes. Three independent repeats apply to selected implemented cases; pending cases never pass. Component/fault tests supplement these end-to-end families and do not inflate their count.

## Shared execution and evaluation policy

- Preserve exactly three stages and the API trust boundary. Python receives no DB driver/credentials, content-write key, administrative tools, original-file storage access or arbitrary URL/file/shell capability. Only the backend serving the disposable test API reaches Postgres.
- Initial subject configuration is Haiku 5.5 Security `medium` / Main `high`, with no LLM in Output. English and Czech are first-class portfolio chat languages; the website remains English-only. No runtime fallback, FastAPI, live chat, public MCP, RAG or knowledge-memory implementation is added here.
- Use the agreed uv/Ruff/mypy-strict/Pydantic-plugin/pytest toolchain and pnpm/Turbo integration. Security/contracts/domain/failure logic is test-first; model-dependent features are evals-first. Every relevant code/critical check passes, ordinary useful answers reach at least 90% per language, supported citations at least 95%, and legitimate false blocking at most 5% per language, with explicit denominators.
- During an issue, run affected paid cases locally through `node harness/with-secrets.mjs -- <command>`, with a justified selection, scope, cost and redacted evidence in its PR. A shared prompt/model/tool/context change can affect the whole implemented catalogue. A partial gate never represents full phase acceptance. Ordinary CI uses fake providers.
- The full paid catalogue runs on the phase PR into `master` or explicit manual dispatch through the existing Model evals workflow extended for Python. Fresh commits can trigger further paid runs. Keep the 20-case Main-model comparison explicit and budgeted in S06, not a per-issue/provider sweep.
- Keep one initial USD 10 eval-campaign allowance across local slices, CI, references, model graders, retries/cache and uncertain usage; carry actual/uncertain spend and remaining allowance forward in redacted issue/phase evidence. A new worktree or CI run does not reset that allowance. Exhaustion leaves required coverage pending and requires an explicit budget increase to continue paid verification. The USD 20/month durable runtime ceiling belongs to phase 7.
- Reuse #171's secret wrapper and #173's case-selection/saved-answer policy. Never inspect or copy owner secrets. Deterministic grader fixes regrade compatible saved answers without model generation; changed model judging is a paid operation. Automatic artifacts allowlist redacted reports instead of uploading raw-answer directories; human examples are explicitly reviewed fictional data.
- Preserve 60 seconds overall, 3 Main decisions, one additional model retry, at most 5 model attempts, 6 tools and 3 independent parallel reads, plus the approved stage/context/token/cost caps and reduced UNCERTAIN limits. Measure p95 approved-answer latency against the <=20-second representative-workload target and record the workload; fake tests do not establish real-model speed.
- Runtime concurrency is distinct from agents editing code. The current phase loop is sequential, and S01–S05 form a chain. They share pipeline/state/registry, prompts, generated contract configuration, uv lockfile, eval tooling and CI, so no concurrent worktrees may edit those shared surfaces without a new explicit file-ownership/dependency plan. Async request isolation is verified in S04; HTTP admission (4 executions, 2-second wait, one active turn/conversation) belongs to phase 7.

## Running and accepting the phase

After the prerequisite owner merges, the owner can start the AFK segment:

```bash
harness/run-phase.sh 06-llm-agent
```

Implementation branches/PRs target `phase/06-llm-agent`. S01–S05 are AFK; they each finish their applicable test/eval gates and merge through the reviewed phase workflow. If a missing credential, candidate failure or exhausted budget prevents a required gate, report the blocker rather than fabricate a pass or silently change the approved model/threshold.

S06 is completed interactively. Once the AFK work is integrated, prepare/open the phase PR with S06 explicitly pending so its full paid CI can run. The owner reviews the comparison and recorded EN/CS human scores, resolves failures and confirms final configuration/evidence on the accepted revision. Attach that evidence and close S06 before final owner merge; do not make acceptance depend on that merge and create a cycle. A loop `phase_done` report, open phase PR or GitHub approval without a scoring record does not close this gate. Only the owner merges into `master`; no phase loop was launched by this publication.
