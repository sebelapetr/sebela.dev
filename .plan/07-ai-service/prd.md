# Phase 7 — AI service and real web chat

|            |                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Approved by the owner; seven implementation issues published                                                                                                                 |
| Date       | 2026-11-20                                                                                                                                                                   |
| Parent     | `.plan/00-overview/prd.md`                                                                                                                                                   |
| Depends on | Phases 3 and 6, including their API/roadmap dependencies; phase 6 is being implemented independently                                                                         |
| Result     | A useful structured-data web chatbot with FastAPI, private conversation ownership, bounded spending, usage UI, manual context compaction and locally pseudonymized telemetry |

Implementation breakdown: [7 published issues](issues.md), with prerequisites and the final owner acceptance gate. Publication starts no implementation or paid run.

Eval cost controls amended on 2026-11-21 by the owner's approval of eight points ([decision 0026](../../docs/decisions/0026-eval-cost-controls-for-later-phases.md)): screening runs during issue work, deterministic C01/C02/C08 mechanics, one Python runner and CI job, a fake model in development, a fixed latency workload and a USD 4.00 phase-7 campaign. Gates, thresholds and critical-100% rules are unchanged.

This change specifies future implementation. It delivers no server, migration, model download, executable eval or passing baseline. The [evaluation specification](evals.md) defines acceptance. Phase 6's three-stage agent and its current issues remain unchanged; phase-7 extensions are implemented after that dependency is accepted.

## Problem Statement

Visitors currently use the phase-3 browser mock. The tested Python agent must become a real website feature before RAG exists. Visitors need one durable conversation, understandable limits and recoverable failures. The owner needs controlled spending and useful evaluation evidence without operating an enterprise AI platform.

The production baseline is the owner's shared ARM64 server: 4 vCPU, 8 GB RAM, ARM64, already hosting other applications. A larger server is possible later. Available capacity and local-model performance are not yet measured.

## Solution and alternatives

```text
browser -> web -> TypeScript API -> FastAPI -> packages/llm-agent
                                           -> public read tools -> API

all stages -> bounded local telemetry processing
           -> field filtering + local pseudonymization -> Langfuse Cloud (EU)
```

- The API is the only database boundary. It owns anonymous identity, one conversation, history, operation state, quotas, execution grants, budget reservations and reconciliation.
- FastAPI owns AI HTTP lifecycle, async admission and execution. It has no database or private-storage access. Read capabilities are separate from internal generation/compaction authority.
- `packages/llm-agent` owns Security -> Main -> deterministic Output, model/tool/context logic and small reusable telemetry interfaces. Pseudonymization is a telemetry branch, not a fourth chat stage. Manual compaction is a separate operation, not an additional tool granted to the answer model.
- The website keeps its existing cards and event-validation seam, replacing the mock and extending ownership/recovery, progress, usage and commands.

Owner-selected approaches:

| Decision           | Alternatives and selected tradeoff                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser disconnect | **Finish and persist**, rather than cancel on disconnect. Return to the same operation without another generation. Explicit Stop still cancels. No durable job broker is introduced.                                      |
| Concurrency        | **One async generation process, four admitted operations**, rather than multiple generation workers whose local limits multiply. Independent read tools can overlap.                                                      |
| Context            | Keep deterministic bounded selection; add **manual `/compact`**. Automatic LLM summarization remains out of scope.                                                                                                        |
| Bot checks         | **Turnstile Managed**, normally unobtrusive with a checkbox when required, plus API quotas and cost limits.                                                                                                               |
| Observability      | **Langfuse Cloud EU, initially Hobby**, rather than self-hosting its web/worker, ClickHouse, Redis and storage stack.                                                                                                     |
| Payload export     | **Automatic best-effort local pseudonymization** for visitor content, rather than manual-only export. Public owner facts stay readable. Residual identification risk is accepted; no claim of complete anonymity.         |
| Local inference    | Prefer **small CPU-compatible NER/PII model through ONNX Runtime**, behind a replaceable detector. No llama.cpp/vLLM server or external GPU initially. Concrete model acceptance depends on EN/CS and ARM64 measurements. |

## User Stories

1. Ask from the hero or `/ask` and receive an approved answer, evidence and website cards in English or Czech.
2. Return to `/ask`, including after closing the page, and see the same conversation and any answer completed while away.
3. Use several tabs without creating a second conversation or concurrent paid operation.
4. Recover a lost response, stop work explicitly or retry a failed operation without duplicate questions or accidental paid replay.
5. See the actual model/effort, personal two-hour/daily usage and a truthfully labelled context meter.
6. Type `/`, discover `/compact`, and reduce working context while retaining the visible history.
7. Have local and linked exported conversation content deleted through the caller's own conversation controls.
8. Inspect pseudonymized traces, run bounded sampled model grading and record human scores without putting visitor text in GitHub.

## Ownership and persistence

- First-party anonymous identity uses a cryptographically random opaque HttpOnly cookie, Secure in HTTPS production and SameSite, with validated settings for local HTTP. Store its verifier rather than a reusable bearer value. No accounts, session picker or cross-device restoration. A lost cookie loses access; a URL never restores identity.
- One active conversation per identity, enforced in the database. A direct `/ask` visit resolves it. A foreign/unknown URL resolves the caller's own conversation, preserving existing history; never reveal whether the foreign conversation exists. Mutations with mismatched identifiers fail safely before changing a conversation.
- Origin/CSRF checks protect cookie-authorized mutations. The web transport preserves the ownership cookie correctly across the server hop; neither a caller-supplied visitor ID nor an untrusted forwarding header establishes identity. Trust client-address headers only from configured proxies.
- Separate private `chat` schema for identities, conversations, logical requests, attempts/operations, messages, summaries, quota/budget reservations, usage and deletion/maintenance state. Extend the existing services/db interfaces; Python, web and MCP import neither `@sebela/db` nor `@sebela/services`.
- Persist the question, approved answer/blocks/sources, terminal status, model/tool/version identifiers, usage/cost uncertainty, latency and guard verdict. Do not persist credentials, headers, hidden model reasoning or IP addresses with conversation content. Keep operational cost records sufficient for accounting even when message content is deleted.
- Visible history is kept without an automatic time limit as previously agreed, with a storage notice and visitor deletion. Bound/paginate reads. Working model context is a separate projection; an old visible message need not still be in that projection.
- Replace the mock's create-many interpretation of New chat with an explicit Clear conversation flow. Confirm deletion, stop active work, remove messages/summaries and arrange linked telemetry deletion. A new empty conversation may follow under the same identity, but quotas are not reset. Prevent late output/export from recreating deleted content. This grants no content-write authority.
- Track Langfuse references and deletion tombstones/retries in API-owned private state. Remote deletion is retried by bounded maintenance; report pending/failure instead of claiming completed removal. No raw visitor material enters tracked fixtures, reports or CI artifacts.

## Operation lifecycle, disconnect and cancellation

- A logical chat request is bound to visitor, conversation, request ID and canonical payload. Its question is appended once. Reusing the ID with a different payload is a conflict; ordinary duplicate POSTs return the existing status/result, not a fresh generation.
- Explicit retry is a separate idempotent action with its own operation identifier: it retains the logical question/request, creates at most one new attempt and replaces that question's failed assistant attempt. It rechecks bot/quota/budget gates. Completed or active work is recovered first; only a retryable terminal failure permits a new attempt.
- Every operation has an ID, conversation revision, deadline, reservation and durable state: accepted/waiting, running, completed, failed, cancelled or interrupted/uncertain. Chat and compaction share the same one-active-operation constraint across all tabs.
- An API-owned task dispatches work and persists its result independently of browser subscriptions. Retain and supervise the task; do not attach its cancellation to an aborted browser request. The visitor can close/refresh/navigate away; reattachment loads canonical API state and approved results. Never generate again merely to reconstruct delivery.
- Persist terminal answer/state before advertising completion. Replay/recover approved events with stable identifiers; a new retry attempt has a new assistant-message/attempt identity. Late events of a replaced/cancelled attempt cannot affect the current answer.
- This guarantees continuation after browser disconnect, not survival of arbitrary API/AI process loss. Recover stale operations from the durable deadline/state after restart; no automatic ambiguous redispatch. Retain conservative spend when provider completion/usage is unknown. A later explicit retry is a new budgeted attempt.
- Explicit Stop and deletion propagate cancellation through runtime, graph, models and tools. Stop scheduling work, cancel supported calls and reconcile reported/uncertain spend. Cancellation may not prevent provider charging. Serialize Stop/completion/deletion races against the operation state/revision.
- One generation process admits up to four operations, each with at most three independent read calls concurrently. Security, Main and Output remain ordered. Do not use multiprocessing merely for remote model/API I/O. Replica/process changes must revisit the cap and maintain API atomicity.
- The admission wait is at most two seconds; excess receives `busy` with no paid work. The 60-second attempt deadline starts at API admission, includes the wait and is passed down without resetting. Shutdown stops admission, drains within the remaining bounded deadline and finalizes unresolved work safely.

## HTTP, authorization and event contract

The builder chooses exact route spelling while retaining these separate operations and generated contracts:

| Surface                          | Operations / authority                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visitor API, through the website | Resolve/load own conversation, submit, read operation/result/progress, explicitly retry/stop, compact, delete, and read own usage. Cookie ownership and bot gates apply as appropriate. No arbitrary visitor/conversation selection. |
| Internal API control             | Claim a specific pre-admitted execution grant and reconcile that attempt's completion/usage. Dedicated service authority, bounded operation-specific payloads; never a generic conversation/content write endpoint.                  |
| Internal FastAPI                 | Run an admitted chat or compaction, cancel a named active operation, health/readiness. Dedicated service bearer, distinct from content API keys and never sent to the browser or model.                                              |
| FastAPI read capabilities        | Fixed public-data reads matching the package tools for phase-8 MCP; bounded schemas/time/page sizes/concurrency/rates. No generation, compaction, conversations, operational data or private API proxy.                              |

- Bind a short-lived, one-use execution grant to the API's operation, context revision, pricing/model configuration, deadline and allowance. Store its verifier in the API; an atomic API claim precedes paid work. Duplicate/replayed grants cannot start another model execution, including after an AI-service restart. Keep the protocol small; no custom LLM proxy, distributed scheduler or content-key reuse.
- Separate AI OpenAPI document with Pydantic validation. Generate Python content/control models from the TypeScript API document and the API's AI-client types from FastAPI where needed; pin generators and check drift. Public capabilities reuse package implementations and public source schemas rather than importing another app or cloning tool logic.
- Reuse phase-3 ordered start/text/block/sources/related/terminal semantics and validate all payloads. Add a small typed progress/operation-status extension where necessary. Use SSE over authenticated fetch for delivery; framing stays in the adapter. Client disconnection ends observation, not execution. Cursor/state recovery cannot replay a paid POST.
- Emit initial status promptly (target within one second under the declared workload) and bounded progress/keepalive frequently enough to avoid the mock's 20-second quiet-time timeout. Explicitly update/test that timeout contract; progress cannot extend the operation deadline. No raw draft, tool text or hidden reasoning is a public progress event.
- Buffer the answer until Output Guard passes; then deliver approved content. Interrupted delivery recovers the stored answer rather than regenerating it. Target p95 approved-content latency remains at most 20 seconds on the fixed latency workload of [evals.md](evals.md) (the 20 `comparison-v1` EN/CS cases); measure first status separately.
- Keep internal reason codes for invalid input, ownership, rate/busy, security block/unavailable, provider/tool failure, budget/deadline, invalid output, cancellation and internal failure. Map them explicitly into a validated public contract instead of letting the mock's narrower codes silently discard new failures. Refusals are distinct from infrastructure failure; messages expose no stack traces or credentials.

## Bot checks, quotas and spend

- Turnstile Managed with `interaction-only` appearance. Obtain a fresh challenge token for a new paid chat/compaction/retry operation; do not require it for loading history, status/result recovery, Stop or deletion. Keep the question during challenge/error states. The hero handoff still submits once.
- API-side Siteverify checks success, configured hostname and expected action before paid work. The public site key may enter the browser; the secret never does. Handle expiry/validation timeout with retry/contact and no model call. Do not rely solely on Cloudflare's token replay detection: atomically bind redemption to one local operation. An idempotent duplicate of an already admitted operation recovers it without another challenge redemption.
- Build tests with official test keys/fakes, no production bypass flag exposed to a caller. Failed bot checks do not silently allow paid execution. Passing Turnstile is not ownership or unlimited authority.

| Quota / allowance                           | Initial setting                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Per anonymous identity                      | 5 new paid operations per rolling minute, 10 per rolling two hours, 30 per UTC calendar day |
| Per short-lived address-derived fingerprint | 20 per rolling minute, 100 per UTC calendar day                                             |
| Global runtime spend                        | USD 2 per UTC calendar day and USD 20 per UTC calendar month                                |
| One ordinary Haiku chat attempt             | Inherit phase 6's USD 0.02 conservative allowance and all stage/token/tool/retry bounds     |

- Count each admitted paid chat, explicit retry and compaction once, including paid refusals/failures. Internal provider retries stay inside that operation. Provisional reservations prevent races; proven no-work busy/bot/input rejection or local compaction no-op releases provisional consumption. Reading/recovering a result does not consume another operation. Limits are configurable server policy, not visitor/model input.
- Derive fingerprints with keyed pseudonymization; keep them outside conversations with short expiry covering only the quota window. Do not retain raw IPs for analytics, put fingerprints in Langfuse or treat a shared IP as a person. Reset/deletion/cookie cycling does not reset global/fingerprint safeguards. Persist counters/reservations sufficiently to preserve limits across restart.
- Reserve conservative whole-operation cost atomically before paid work. Sum committed, active and uncertain spend against both global windows; never free uncertain spend on disconnect/restart or retry. Before admission, also reserve the same conservative operation ceiling in every UTC day/month in which a model call could start before its absolute deadline (at most two adjacent days/months for this 60-second operation). This avoids unreserved work across midnight without a per-call network reauthorization protocol. Settle reported usage by model-call start time; keep full uncertain reservations in affected windows when attribution is unknown. This is the application ledger policy, not a guarantee about the provider invoice date. Test boundary races.
- Enforce caller-granted allowance before every provider call, including retries, compaction and guard refusal usage. No overlapping SDK/graph retries or automatic cross-model fallback. Reconcile once idempotently, with pricing version and estimated/reported/uncertain amounts; repeated callbacks cannot double-charge or refund.
- Offline production grading has its own explicitly granted batch budget and is disabled until invoked. It is not a visitor operation or an implicit unlimited background cost. Development/acceptance evals have their own phase-7 campaign of USD 4.00 ([evals.md](evals.md), Run policy and budgets), separate from phase 6's campaign; do not reset that allowance per issue/worktree/CI run.
- Development uses a fake model by default. The local AI service and development stacks never call the paid provider unless explicitly enabled through `harness/with-secrets.mjs` with a flag, and then under a development runtime ceiling of about USD 0.25 per UTC day. Tests and Playwright use fakes.

## Context, usage UI and slash commands

- Retain phase-6 bounds: at most 16,000 main-input tokens, selected history at most six complete exchanges and 6,000 tokens, current question at most 1,000 tokens, main output at most 8,192 tokens including thinking/structure, and all aggregate/stage allowances. The existing web contract additionally caps the question at 1,000 characters. Enforce both; do not quietly expand one to match the other.
- Deterministically preserve instructions, tool-call/result pairs and source identities when selecting context. Stored history may be larger than model context. No automatic compaction or background LLM summary.
- Add a discreet read-only model/effort label and expandable usage panel beside the existing composer. Values come from canonical API policy/operation snapshots; initially one configured model/effort, no selectable controls or client-side authority. Show historical answers' actual model when configuration changes.

```text
Model: Haiku 5.5    Effort: high                 [illustrative configuration]
Last 2 hours       6 / 10 operations             60%
Today             6 / 30 operations             20%
Last request context  12k / 16k input tokens     75%
```

- Two-hour usage is rolling, not a fixed reset bucket. Show next capacity release when limited, daily reset time in a clear timezone, and server timestamps so tabs/countdowns agree. Include active reservations in usage without representing uncertain usage as free. Distinguish a fingerprint/global restriction from the personal percentage; no shared spend balance is exposed.
- Context means the serialized input to the last main call, including instructions, tool definitions, selected history, question and evidence, against the effective 16k input cap. Label tokenizer estimates as approximate; provider-reported usage separately if available. A next-request estimate after compaction is explicitly an estimate excluding not-yet-fetched evidence. Never show a hypothetical native 100k window, hidden reasoning, or cumulative lifetime tokens as context fullness. Missing values are unavailable, not invented zeroes.
- Use neutral existing design tokens, orange above 70% and red above 90%, with number/text labels as well as colour. At 100% show the limiting reason and recovery time. Preserve accessibility, mobile keyboard space and 360/768/1280 px light/dark checks. UI copy remains English; answers support EN/CS.
- Leading `/` opens a small filtered command suggestion popup. Initially only `/compact`; arrows/Enter/Escape, touch selection, focus and accessible combobox/listbox semantics. Slash inside normal prose is not a command. Unknown commands get a local explanation, not an invented model tool. No command permits arbitrary tools, model changes or sessions.
- `/compact` is an authenticated, bot-checked, budgeted operation when useful. It shares admission and the conversation lock; another tab shows its progress and cannot generate concurrently. It does not append the command as a visitor question or erase the visible history; report a concise compaction result and updated context estimate.
- Summarize the current bounded working history (previous accepted summary plus newly selected complete exchanges), not the entire unbounded database transcript. Keep recent exchanges intact within the same 6k history allowance. Already-excluded history is not magically recovered; make that limitation explicit in the command description/help.
- Start with the accepted main model/effort, no tools, one logical summary call and at most the existing single bounded transient retry; maximum 60 seconds, main input/output bounds and USD 0.02 allowance including retry. Builder default: target a summary of at most 1,000 visible tokens, hard cap 1,500 within the 6k total history allowance. Version its prompt/schema and validate the complete result before installation.
- Preserve visitor goals, language, unresolved questions and record references; do not promote assistant guesses to owner facts. Treat summaries as untrusted history, never system instructions or authorization. Continue to fetch current portfolio facts from the API. Invalid/failed/cancelled compaction keeps the previous context unchanged. Install atomically against the conversation revision; deletion or later state changes cannot be overwritten by a stale result.
- Empty/already-small working context is a local no-op before model work. Compaction counts as one paid usage unit when run and never resets the two-hour/day quota or global spend.

## Pseudonymization and Langfuse

- Langfuse Cloud in the EU region, initially Hobby. The API remains the source of truth for history, operation state and spend. SDK/export failure cannot block a valid answer, change a safety verdict or free a reservation.
- Export metadata for every operation and pseudonymized visitor inputs/visible outputs/selected tool content automatically when the local detector is accepted and available. Keep public owner data supplied by approved API projections readable. Do not exempt an entire tool payload or visitor sentence merely because it mentions a public name; provenance-aware exceptions cannot whitelist unrelated personal data or secrets.
- Filter allowed fields before export, mask recursively and bound payloads. Exclude cookies, authentication headers/keys, raw IP/fingerprints, hidden reasoning and raw exception/request dumps by construction. Names/resources/events/media/third-party callbacks must not provide an unmasked path around the exporter; disable raw media capture and instrument only documented safe fields. An SDK masking callback alone is not proof of full coverage.
- Combine deterministic patterns for emails, telephone numbers and known sensitive identifier formats with a small local multilingual NER/PII detector for names/addresses/free text. Presidio is an orchestration candidate; a CPU/ONNX-compatible GLiNER-family model is a detector candidate, not a settled model or measured baseline. Verify actual English/Czech support, ARM64 packages, model license, pinned revision/checksum and supply chain before selection. No runtime arbitrary model download or remote code from model metadata.
- Hide complete sanitize/export behaviour behind a small package interface. Configure detector/model revision/runtime/thresholds/limits centrally; swapping a compatible model is configuration plus deployment and re-evaluation. A different runtime needs a small adapter, not pipeline changes. Do not implement speculative GPU/cloud adapters now.
- Use pseudonymous visitor/conversation identifiers and stable scoped replacements where useful, without exporting a reversal table. Raw originals remain in API-owned persistence under the agreed ownership/deletion policy. Free text can still identify a person; best-effort pseudonymization is not claimed anonymity. The owner's illustrative 90% is not an already-measured guarantee.
- Start with one local masking job at a time, bounded text/chunks, bounded in-memory queue and controlled inference thread count outside the async request loop. Measure resident memory including cold start, CPU, throughput and impact on four chat operations on the actual ARM64 baseline. Agree an explicit deployment resource envelope before enabling payload export. A development laptop result is not production proof. No unbounded raw spool or new broker/service is required.
- If masking is missing, times out, exceeds capacity or fails quality/resource acceptance, export only allowlisted metadata or drop the unsafe event. Never silently fall back to regex-only full-text export or an external GPU receiving raw text. Report degraded payload export. If no detector fits the shared ARM64 server, record metadata-only operation explicitly at owner acceptance; a later server/model change reruns the same checks.
- Capture stage/model/tool/retry spans, reasons, usage, cost and version identifiers with pseudonymous correlation. Pseudonymization applies before each external telemetry export, not merely after Output Guard. It does not automatically sanitize input sent to the external Security/Main/compact model provider; that is a different boundary and this design does not claim otherwise.
- Delete exported conversation content and linked traces/scores after **30 days**, with retryable bounded maintenance and observable deletion status. Hobby's 30-day data-access window is not deletion. Visitor deletion also schedules prompt removal of linked exports; retain only minimal non-content deletion/accounting state. Use bounded scheduled API-side maintenance (for example a documented host timer invoking the maintenance command), not a new scoring service. Keep trace IDs and export/expiry timestamps locally so deletion does not depend on rediscovering data outside Hobby's read window. Use the deletion API, retry until its documented completion semantics are satisfied and avoid copying real conversations into datasets with a different lifetime.
- Model grading of real answers is a manually invoked, explicitly selected batch with its own maximum cost, never every visitor request. Code checks cover every answer; human grading uses a Langfuse annotation queue for disputed answers and a sample of successes. Record rubric/model versions and selection; convert confirmed problems to fictional regressions. Do not automatically train on visitor text or enable a second uncontrolled cloud evaluator.

## Approximate file structure

These paths show responsibilities, not mandatory empty files. Reuse phase-6 entries; split a module only when behaviour warrants it. Create/update each owning `AGENTS.md` map, exported interfaces and generation/drift checks during implementation.

```text
apps/ai-service/
  AGENTS.md, Dockerfile, package.json, pyproject.toml
  src/ai_service/
    __init__.py, app.py, config.py
    routes/{generation.py,compaction.py,capabilities.py,health.py}
    runtime/{__init__.py,admission.py,execution.py,shutdown.py}
    clients/control_api.py
    generated/control_api/              # native generated API control client
    schemas/{requests.py,responses.py}
  tests/{unit/,integration/}
  evals/                                 # only if needed: HTTP-specific cases, never the phase-6 catalogue

packages/llm-agent/src/llm_agent/
  context/{history.py,tokens.py,compact.py}    # extend phase-6 context entry
  prompts/compact.py
  schemas/compaction.py
  observability/{__init__.py,tracing.py,telemetry.py}
  observability/pseudonymization/{__init__.py,policy.py,detector.py}
  # existing graph/stages/model gateway/read tools remain the shared implementation
packages/llm-agent/evals/                # phase-7 paid cases join the phase-6 runner, budget module and ledger

apps/api/src/
  modules/chat/{index.ts,routes.ts,identity.ts,runtime-client.ts}
  generated/ai-service/                  # generated FastAPI types/client if needed
  cli/chat-maintenance.ts                # redacted/deletion maintenance commands
packages/contracts/src/modules/chat/     # extend the existing public entry
packages/services/src/modules/chat/      # one entry: ownership/lifecycle/quotas/ledger
packages/db/src/modules/chat/            # one entry: private persistence/atomic operations
packages/db/migrations/                  # generated/committed chat migration

apps/web/src/modules/chat/
  data/{api-adapter.ts,commands.ts,usage.ts}
  stores/conversation-store.ts
  hooks/use-conversation.ts
  components/{chat-view.tsx,usage-panel.tsx,command-menu.tsx}
apps/web/e2e/chat-*.spec.ts
```

Use the existing uv workspace/lock, Ruff, strict mypy with Pydantic support and pytest. pnpm/Turborepo invokes package wrappers and affected checks; Docker/Compose builds and runs services. They have different responsibilities. Update declared task dependencies for control/content generation, shared Python changes and the actual test API build; no pnpm services/db dependency is added to Python to fake the runtime graph.

Add FastAPI's Dockerfile/Compose profile, configurable addresses, worktree slots, health/readiness, shutdown and task wrappers. Its network reaches the API but not Postgres, admin MCP or private originals; internal generation is not host/publicly published. ARM64 image validation is required before production. Extend current Compose-policy/stack checks rather than inventing a deployment platform.

## Testing and acceptance

Follow [evals.md](evals.md): deterministic tests first for contracts, ownership, state, grants, quotas/reservations, bot checks, deletion and failures, including the mechanical C01/C02/C08 scenarios; fictional eval cases before compact/masking behaviour. Ordinary tests use fakes. EN/CS quality gates from phase 6 remain required; do not rerun automatic reference-model sweeps.

Per issue, run only affected paid cases with recorded scope. While a prompt or schema is still changing, screen with 1 repeat without the judge, then 1 judged repeat; only the final version's run with 3 repeats and the pinned judge counts for the issue's gate, and screening answers are never pooled into a gate. A rerun of affected phase-6 cases during issue work runs only their code-graded critical cases; judged ordinary cases wait for the phase-PR run (the #182 precedent). At the phase PR into `master`, run the complete phase-6 suite plus the implemented phase-7 extension, three repeats, in one run of the Python agent runner, then owner human grading on 12 answers taken from that stored run. The Python agent eval job runs on a PR into `master` when it is opened/reopened/marked ready and the change touches the agent package, its prompts/evals or the API operations it calls, or by explicit manual dispatch; no charged run on each push or issue PR into the phase branch. Keep the saved-answer/regrade/secret-wrapper rules and the phase-6 cost controls (batch judge, caching, per-chunk reservation, early stop, deadline).

Owner acceptance records the final model/effort, measured ARM64 resource envelope or explicit metadata-only fallback, Turnstile/Langfuse configuration, 30-day deletion proof, real browser recovery and the linked human score record. An approval click or passing fake suite is not evidence of paid quality, production capacity or privacy perfection. Missing keys, exhausted budget and unperformed server measurements remain pending.

## Out of Scope

Public MCP transport/setup page (8), retrieval/extra-document ingest (9), knowledge graph (11), ontology (12), external MCP UI (13), visitor accounts/multiple sessions/cross-device restoration, automatic compaction, model/effort selectors, uploads/arbitrary browsing, external GPU inference, llama.cpp/vLLM serving, distributed workers/Redis/Kafka/Temporal, self-hosted Langfuse and an automatic production-grading schedule.

## Builder decisions and checked references

The owner selected product behaviour and initial quotas above. Exact route names, compatible pinned SDK/generator versions, schema/table internals, identity-cookie rotation, concrete PII candidate and measured resource allocation are builder decisions within these bounds. Summary target, SSE delivery and explicitly typed progress are approved implementation defaults; they cannot weaken safety, ownership, budget or failure semantics.

References checked 2026-11-20: [Turnstile modes](https://developers.cloudflare.com/turnstile/concepts/widget/), [Siteverify and replay limits](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Langfuse pricing](https://langfuse.com/pricing), [masking and exporter limitations](https://langfuse.com/docs/observability/features/masking), [annotation queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues), [deletion API](https://langfuse.com/docs/administration/data-deletion), [access versus retention](https://langfuse.com/faq/all/data-access-vs-data-retention), [Presidio languages](https://github.com/data-privacy-stack/presidio/blob/main/docs/analyzer/languages.md), [GLiNER ONNX](https://github.com/urchade/gliner/blob/main/docs/convert_to_onnx.md), [ONNX CPU/ARM64](https://onnxruntime.ai/docs/get-started/with-python.html).
