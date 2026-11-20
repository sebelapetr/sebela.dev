# Phase 7 — AI service and real web chat

|            |                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Draft, revised after the owner's architecture discussion; awaiting document approval                                                   |
| Date       | 2026-11-17                                                                                                                             |
| Parent     | `.plan/00-overview/prd.md`                                                                                                             |
| Depends on | Phases 3 and 6 (including their API and roadmap dependencies)                                                                          |
| Result     | FastAPI wraps the tested agent; the website answers from structured API data with durable conversation, reliability and spend controls |

## Problem Statement

The reusable agent works locally, but visitors still see a mock. Make it available through a thin AI runtime and replace the mock without rebuilding the web UI. The chatbot must already be useful before RAG exists.

## Solution

```text
browser -> web -> api -> ai-service -> packages/llm-agent
                                     -> read tools -> api
```

- `apps/api` owns visitor identity, one conversation per visitor, persistence, authorization, idempotency and the authoritative spend ledger.
- `apps/ai-service` owns separate FastAPI routes, generation admission, request lifecycle, concurrency, deadlines and cancellation. It is stateless between requests and has no database access.
- The package owns stages/tools/model logic; FastAPI does not duplicate it.
- Read capabilities are exposed as a separate interface for phase-8 MCP. Public read operations cannot invoke generation, private content routes or the model budget.
- Content API keys and the internal generation credential are distinct. The service credential stays outside model context and grants no content-write authority.

## User Stories

1. A visitor asks from the homepage or `/ask` and receives an approved answer with sources and website cards.
2. Returning directly to `/ask` restores the same visitor's conversation without choosing sessions.
3. Another visitor cannot read, continue or delete that conversation, even with its URL.
4. A visitor can cancel, recover an interrupted submission and retry without duplicate turns or duplicate generation.
5. Limits and failures produce understandable states and a contact option.
6. The owner can bound spending and inspect redacted traces without changing the agent pipeline.

## Implementation Decisions

### Conversations (API)

- Implement the shared event/block contract established in phase 3 (`.plan/03-web/prd.md`, "Chat contract and failure states"). Replace the mock adapter while preserving its event semantics, identifiers, validated payloads and incomplete-answer/retry behaviour. Transport framing stays outside presentation components. Generate the Python-facing schema/client from the API contract rather than maintaining handwritten duplicate event definitions.
- Make client request identifiers idempotent within the owning visitor's conversation: retrying an interrupted submission cannot append duplicate user turns or unintentionally start concurrent generations. Record and expose whether an attempt completed, failed or remains active so an ambiguous disconnect can be recovered safely. Contract and security tests precede implementation.
- A new schema for conversations and messages, apart from content.
- **Identity:** a conversation has a random, unguessable identifier that appears in the address. It identifies; it does not authorise.
- **Ownership:** an anonymous visitor cookie (HttpOnly, Secure, SameSite). Every request is checked against it. A foreign/unknown conversation identifier never exposes or modifies the linked conversation. Resolve the caller's own existing conversation instead; create an empty one only if that caller has none. Never clear their existing history because they opened someone else's link.
- **Stored per message:** the text, the blocks, the sources, the tools called, the models used, tokens and cost, latency, the guard's verdict, and afterwards the scores.
- **Kept without a time limit**, for analysis. The visitor's address is **not** stored with a conversation; rate limiting uses a short-lived fingerprint kept elsewhere.
- A visitor is told that questions are stored and can have a conversation deleted by its identifier.
- These are the only write routes that are public. They are limited to creating, continuing and deleting the caller's own conversation and can touch nothing else; the test that walks every route treats them as a named exception.

- One active conversation per anonymous visitor identity, with no session picker or create-many endpoint. Direct navigation to `/ask` resolves that conversation from the cookie; a URL identifier is never authorization.
- "Visitor" means the anonymous identity in that browser, not a recognized person across devices. Clearing the cookie or switching browsers cannot restore the previous identity. Deleting the conversation removes its messages and permits a fresh empty conversation under the same simple flow.
- The model receives only bounded context selected from the stored history. This is conversation context, distinct from the knowledge base about Petr.

### Limits, context and cost

- Inherit the approved [phase-6 limits](../06-llm-agent/prd.md#initial-execution-limits-and-async-behaviour): 60-second end-to-end attempt deadline, 6 tools, 3 main decisions, at most 5 model attempts including one shared retry, bounded context and USD 0.02 initial Haiku allowance. API admission starts the deadline before the bounded wait; calling the package does not reset it. The initial durable runtime ceiling is USD 20 per calendar month (UTC), separate from the USD 10 initial evaluation campaign. Never silently increase allowances after a model/pricing change.
- API/AI runtime paths use nonblocking I/O and async provider/content clients. Start with 4 admitted executions in one AI-service process, one active turn per conversation, and a 2-second maximum admission wait; excess requests receive `busy` without paid work. Independent reads may run up to 3 at a time per execution. A replica/process change must revisit the process-local cap and preserve atomic API spend reservations.
- Return an initial status event promptly (target within 1 second under the documented test workload). Target p95 time to approved content at most 20 seconds on a representative EN/CS workload; record workload, concurrency and measured values. The 60-second deadline is a failure ceiling, not normal latency.

- Before paid work: input byte/message limits, conversation ownership, visitor/fingerprint limits, bot checks and an atomic budget reservation. Bot detection requires no third-party cookies; choose its mechanism at phase start.
- The API owns the durable daily/monthly cost ledger. Reserve a conservative upper bound for the entire attempt, including security, generation, retries and fallback, before admitting it. Concurrent reservations cannot collectively exceed the remaining allowance.
- The runtime enforces the granted request allowance before every model call: stage/request tokens, estimated cost, maximum LLM calls, tool calls/iterations and wall-clock deadline. Retries and repair/fallback attempts count towards these same limits. It cannot grant itself more allowance.
- Reconcile measured usage through the API, including guard refusals and failed attempts. Unknown usage is charged conservatively against the reservation; interruption or process restart never immediately frees uncertain spend. Provider-side limits are additional controls, not an assumed universal hard cap. Record pricing version and distinguish estimated from reported usage.
- A context manager allocates system instructions, bounded history, tool results and output reserve for the configured model. Preserve instructions, tool-call/result pairing and complete source references. Drop older complete turns and bound tool payloads deterministically; no LLM summarization or durable memory is required initially.
- Limit and unavailable states produce a stable status and contact option. No model call is needed to explain a limit.

### Delivery and failure contract

- Progress/status events can be sent immediately. Buffer the generated draft until Output Guard completes, then deliver validated content through the phase-3 event/block adapter. No unvalidated model token reaches the visitor. Measure time to first status and time to first approved content separately; initial delivery is not live token streaming.
- Error codes distinguish `invalid_input`, `unauthorized`, `rate_limited`, `busy`, `security_blocked`, `security_unavailable`, `provider_unavailable`, `tool_unavailable`, `budget_exceeded`, `deadline_exceeded`, `invalid_output`, `cancelled` and `internal_error`. Keep refusal separate from infrastructure failure; public messages omit exception details and credentials.
- Concurrency uses a bounded semaphore in a single AI-service process, with a bounded wait and explicit `busy` response. Start with one generation process so the configured limit is meaningful. Drain on shutdown; health/readiness reflects initialization, not a paid model probe. Multiple replicas require revisiting this policy.
- Propagate request cancellation/deadlines through the graph, model and tool clients. Stop scheduling new work, cancel supported in-flight calls, finalize attempt state and reconcile uncertain costs. A provider may complete and charge after local cancellation.
- The API is the idempotency authority: bind a request ID to visitor, conversation and payload; reject reuse with a different payload; return the existing status/result for duplicate submissions. Admit only one active turn per conversation. Recover stale attempts after restart before accepting a retry; do not blindly replay an ambiguous generation. The API does not transparently retry generation HTTP submissions; it recovers the existing attempt first.
- Centralize retry policy and disable overlapping SDK/graph retries. Transient timeouts/429/5xx may have one bounded retry with jitter/Retry-After within the deadline and allowance. Do not retry invalid input, authentication, refusal, exhausted budget or arbitrary side effects. An unavailable tool returns a typed failure, never invented data.
- Fallback is optional, explicit and evaluated for the same required capabilities. Never restart generation after approved content has started delivery; mark interrupted output incomplete and recover through the existing attempt contract.

### HTTP and deployment boundary

- Separate AI OpenAPI contract, validated with Pydantic; content/event models still come from the TypeScript API OpenAPI document. CI detects drift in generated artifacts.
- Generation is internal, service-authenticated and admitted by the API's allowance. Read capability routes are a separate validated, bounded, rate-limited surface. Read credentials/requests cannot become generation authority.
- Create the FastAPI app's `AGENTS.md`, Dockerfile, Compose service, shutdown/health behaviour, configurable URL/port, worktree settings and lint/typecheck/test/build task wrappers here.
- Start with one generation process and bounded concurrency. No extra queue/worker or distributed coordinator is introduced.
- The runtime and read tools must not receive the admin key or storage credentials for knowledge originals. Only the backend accesses persistence.

### Website

- Replace the phase-3 mock using the existing validated event/block adapter. Preserve hero handoff, errors, incomplete-response state and idempotent retry semantics.
- Returning to `/ask` loads the browser identity's conversation. No session selection, accounts or cross-device restoration.
- Show progress while the answer is prepared, then deliver the validated response. Web cards are retained; external MCP UI is not part of this phase.
- Show sources, honest unknown/contact responses and the conversation-storage notice. Do not claim retrieval or additional-document knowledge before phase 9 exists.

### Monitoring

- Langfuse receives nested spans for stages, model/tool calls, retries and final outcome, with usage, estimated/reported cost, latency and reason codes. Correlate request/attempt/trace IDs and pipeline, prompt, model, pricing and dataset versions where applicable.
- Redact credentials and personal data before export. Metadata is the default; payload capture is explicit, access controlled and configured with retention/deletion. Conversation deletion covers linked telemetry where text was captured. No API keys, headers or system secrets in prompts or traces.
- Scoring runs after the visitor request through an explicit command/scheduled batch, with its own budget. Code/model scores and human review identify weak answers, refusals and knowledge gaps. It does not automatically train models on visitor text.
- Cloud versus self-hosted Langfuse remains a phase-start decision. Verify available review features and data handling before choosing. Core attempt state, usage and budget accounting are stored by the API and survive telemetry outages. Export failure must not block a valid answer or bypass a limit.
- Keep telemetry behind a small package interface with portable identifiers and OpenTelemetry-compatible instrumentation where supported; no additional telemetry service is required.

## Testing Decisions

- Test-first for ownership, identity recovery, visitor deletion, idempotency/conflicting payloads, one active turn per conversation, stale-attempt recovery and durable reservations.
- Test classifier/provider/tool failures, retry/cancellation/deadline propagation, busy admission, unknown spend, SDK retry configuration and telemetry failure.
- Reject generation without the dedicated service credential; exercise read requests trying to reach generation and all private content operations.
- End to end with fakes: hero -> `/ask` -> approved text and card -> refresh/direct `/ask` restores -> follow-up uses bounded history. A second browser with the same URL cannot obtain the conversation; if that browser already has its own history, opening the foreign URL preserves and resolves its own conversation.
- Reuse the phase-3 contract scenarios; no unvalidated draft token is emitted. During issues run affected local paid cases only, with scoped evidence; run the complete relevant phase-6 plus phase-7 integration catalogue on the phase PR into `master`, then record owner human scores before acceptance. Preserve case selection, compatible saved-answer regrading, all three grader types and the secret wrapper; do not rerun reference-model comparisons automatically.

## Out of Scope

- Public MCP transport/setup page (8), retrieval and extra-document ingest (9), graph (11), ontology (12) and external MCP UI (13).
- Session management, visitor accounts, cross-conversation personal memory, file uploads by visitors or arbitrary website browsing.
- A separate LLM proxy, distributed runtime, Redis/Kafka/Temporal or a scoring service.

## Further Notes

- Choose bot checks and Langfuse hosting with current documentation and owner input; keep global daily/monthly ceilings configurable. The owner sets production amounts before launch.
- Conversation retention remains unlimited for analysis as previously specified, with notice and visitor deletion. Confirm the legal/retention policy before launch; do not commit real conversations or owner data.
