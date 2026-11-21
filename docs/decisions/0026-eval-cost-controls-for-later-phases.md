# 0026 — Eval cost controls for phases 7, 7.1 and 8

Status: accepted
Date: 2026-11-21

## Decision

The owner approved the following eight points on 2026-11-21. They extend the phase-6 cost controls ([batch judge, judge caching, no charge for runs that never started and early stop](https://github.com/sebelapetr/sebela.dev/issues/183#issuecomment-7064345423); [reservation per chunk and the per-run stop](https://github.com/sebelapetr/sebela.dev/issues/183#issuecomment-7064482195)), which apply to phase 7 as they stand in `packages/llm-agent/AGENTS.md` (Evals, Policy). Every gate, threshold and critical-100% rule stays unchanged.

1. **Screening during issue work.** While a prompt or schema is still changing, a paid run uses 1 repeat without the judge, then 1 judged repeat. Only the final version's run with 3 repeats and the pinned judge counts for an issue's gate. Screening answers are never pooled into a gate.
2. **Mechanical phase-7 cases are deterministic.** C02 (two tabs, no second generation), C08 (failure leads to a safe state, no automatic paid replay) and the disconnect/one-attempt half of C01 become deterministic tests with fakes, with their critical assertions at 100%. The answer prose of follow-ups stays measured by the phase-6 family Q17.
3. **One runner and one CI job for the catalogue.** Phase-7 eval cases live in and run through the Python agent runner (`packages/llm-agent/evals`) and its existing CI job. An `apps/ai-service` job, if any, runs only HTTP-specific cases and never re-runs the 80 phase-6 cases. There is one budget module and one ledger.
4. **Development uses a fake model by default.** The local AI service and development stacks never call the paid provider unless explicitly enabled through `harness/with-secrets.mjs` with a flag, under a development runtime ceiling of about USD 0.25 per day. Tests and Playwright use fakes.
5. **Latency measurement has a fixed workload.** The 20 `comparison-v1` cases × 3 repeats at concurrency 1 and at 4, Haiku only, no judge, never batched (about USD 0.25).
6. **Phase-8 public MCP evals.** Deterministic first (protocol, schemas, parity, no generation, unknown tool, limits). Then a small paid set (about 12 cases × 3) graded by code (expected tool calls and arguments, cited source IDs), with the judge only on truthful-source cases. The pinned subject is Claude Haiku 5.5 for development and the gate, plus one confirmation run with Claude Sonnet 5.5 at the phase PR (about USD 1.3). It uses the Python budget module, ledger and allowance, and prompt caching on the fixed tool list.
7. **A budget per phase campaign.** Phase 7: USD 4.00 (issue work stops at a cumulative USD 1.50; USD 2.00 is kept for the phase-PR full run and one affected rerun; USD 0.50 margin is released only by the owner). Phase 7.1: USD 2.00, its own campaign. Phase 8: USD 2.30 (USD 1.00 Haiku campaign plus USD 1.30 Sonnet confirmation). The per-run stop of USD 1.00 applies to issue runs, not to the full phase-PR run. The code currently hard-codes a USD 10 cumulative ceiling; a separate change makes the ceiling per campaign.
8. **When the Python agent eval job runs.** On a pull request into `master` only when the agent package, its prompts or evals, or the API operations it calls change (a separate change implements the rule, like MCP Admin's `scripts/checks/mcp-admin-evals-affected.mjs`); otherwise the owner dispatches it by hand.

Two working rules follow from them. During phase-7 issue runs, a rerun of affected phase-6 cases runs only the code-graded critical cases; judged ordinary cases wait for the phase-PR run, as in issue #182. The owner's 12 human-review answers are taken from the stored phase-PR run instead of a separate generation.

## Why

The phase-6 campaign showed where money goes: repeated full runs, judge calls and reruns of cases a change did not affect. Phases 7 and 8 add mostly mechanical behaviour (HTTP lifecycle, tabs, failures, MCP protocol) that a fake proves better than a model, and their genuinely model-dependent cases are few. A fixed budget per phase campaign, with a reserve for the phase-PR run, makes overruns visible early instead of draining a shared remainder.

## Rejected

- Carrying the shared USD 10 campaign forward across phases: one phase could spend the next phase's acceptance run.
- Paid model cases for tab, disconnect and failure mechanics: a model adds cost and noise without proving the state machine.
- A second runner or eval job in `apps/ai-service` that reruns the phase-6 catalogue: duplicate spend and two ledgers.
- Calling the paid provider from local development stacks by default.
- Gating phase 8 on Sonnet alone, or on a judge for every case.

## Relationship to earlier decisions

Changes the eval budget rules written in `.plan/07-ai-service/`, `.plan/08-mcp-public/prd.md` and `.plan/09.1-rag-integration/prd.md`, which are updated with this record. The archived phase-6 plans and earlier records are not rewritten.
