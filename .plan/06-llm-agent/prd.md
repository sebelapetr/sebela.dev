# Phase 6 — Reusable LLM agent

|            |                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Approved by owner; implementation issues published                                                                                |
| Date       | 2026-11-19                                                                                                                        |
| Parent     | `.plan/00-overview/prd.md`                                                                                                        |
| Depends on | Phases 2, 4 and 5                                                                                                                 |
| Result     | A tested Python library runs a bounded three-stage chat pipeline over structured API read tools; no HTTP server or RAG dependency |

Implementation breakdown: [6 published issues](issues.md), with prerequisites and the final human acceptance gate. Publication starts no implementation or paid run.

## Problem Statement

The content API exists and the owner can manage it through MCP Admin. The website still uses prepared chat answers. Before adding another server, build and evaluate the answer-producing capability as an independently runnable Python package.

The result must be understandable as one chat pipeline, not a platform for hypothetical agents. It must answer only from evidence, preserve built/tested/designed status, and refuse unsupported claims without relying on a prompt as an access-control boundary.

## Solution

`packages/llm-agent` owns the reusable AI logic. A local runner and tests invoke it directly. FastAPI is added in phase 7 and public MCP in phase 8; neither is a dependency of this package phase. Structured content tools work before retrieval exists. RAG is added in phase 9, graph in phase 11 and ontology in phase 12.

## User Stories

1. As a developer, I can run the pipeline locally with fake providers before paying for model calls.
2. As a visitor, I get evidence-backed answers about the profile, projects, services and learning activity.
3. As a visitor, I get an honest unknown/contact response rather than invented skills or dates.
4. As the owner, I can independently evaluate security classification, tool use and output validation.
5. As a developer, I can configure security/main models without changing application routes.
6. As a reviewer, I can locate pipeline, model, tool, policy and evaluation responsibilities in documented folders.

## Implementation Decisions

### Package boundary

- Python library, not a deployable. No FastAPI/MCP server, conversation database, website integration or database driver is created in this phase.
- Public operation: run chat with validated question/context, execution identifiers, deadline, bounded allowance and a cancellation signal; return a typed approved response/outcome, evidence and measured usage.
- The caller grants allowance; model output cannot change execution policy. Phase 7 adds durable API admission and reservations around this interface.
- The content API remains the only gateway to stored data. Generate the Python content client/models from its committed OpenAPI contract with the pinned `openapi-python-client` guidance in `packages/api-client/AGENTS.md`; put generated code under `src/llm_agent/generated/content_api/` and extend the generated-drift check. Generation may describe private operations in the API contract, but the handwritten adapter exposes public reads only and the runner never receives a content-write key.
- Keep system instructions, visitor text and returned evidence separate. Public content is still untrusted input to the model.

### Product behaviour and languages

- English and Czech are first-class chat languages. Answer in the visitor's requested language, otherwise the language of their question; keep names and factual source values intact. A short ambiguous follow-up inherits the previous language, with English as the initial default. The website itself remains English-only.
- Answer portfolio questions and technical questions grounded in the owner's projects, learning and experience. Role-fit assessment may make labelled inferences from evidence; never turn a tested/designed exploration into delivered expertise.
- General tutoring, unrelated advice and requests to build software are outside scope. Politely redirect to relevant portfolio experience or contact. An ordinary question about the portfolio's AI security is legitimate, not an injection verdict.
- Missing information produces an honest unknown response with the trusted contact block. Safe fixed refusals, limits and unavailable responses have EN/CS variants and do not need another model call.

### Read tools

Profile; experiences and their projects and case studies; explorations with their status; services with their evidence; technologies; education; current focus; the AI Roadmap tree and progress; diary and statistics; books; events; search only when added in phase 9.

- Every tool returns data with **source references** — the entity, the record, the address and anchor on the site. Sources in an answer can only come from these.
- Tool descriptions say when to use each one: exact facts from the structured tools, open questions from search.

- No raw SQL, arbitrary URL/file/shell tools or administration tools. Source identifiers and links come from API evidence, not model invention.
- The chatbot invokes these implementations in-process. Later public MCP calls the same capabilities through FastAPI; the chatbot never loops through its own MCP server.

### Chat pipeline: exactly three stages

LangGraph orchestrates `pipelines/chat`; the Main Agent contains the bounded tool-calling loop. Stage contracts are Pydantic models. Shared execution state carries request/trace identifiers, versions, deadline, remaining allowance, usage and evidence; model text cannot modify execution policy.

| Stage            | Input                                                                      | Output                                                             | Transition                                                                                |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Security Gateway | Validated question and bounded conversation context, classification policy | `ALLOW`, `BLOCK` or `UNCERTAIN`, category and reason code          | Allow -> Main; block -> fixed response through Output Guard; uncertain -> restricted Main |
| Main Agent       | Accepted context, restrictions, allowlisted tools and remaining allowance  | Draft text, typed UI blocks, source IDs and evidence ledger        | Draft -> Output Guard; failure -> safe fallback through Output Guard                      |
| Output Guard     | Draft or fixed response, evidence ledger and output policy                 | `PASS`, `REPAIR` or `REPLACE`, validated response and reason codes | Terminal response; never invokes a model                                                  |

- **Security Gateway:** deterministic validation plus a cheap model with its own versioned prompt/configuration. It classifies; it never answers or calls tools. Categories cover injection, off-topic requests and abuse. Optional confidence is uncalibrated metadata, not a probability or authorization signal.
- `BLOCK` uses a fixed polite response; a playful "Nice try ;)" is reserved for an explicit manipulation verdict, never ordinary questions about AI security. `UNCERTAIN` retains the same read-only capabilities with tighter call/context limits and instructions to decline unsupported requests. Classifier timeout, invalid output or unavailability stops generation with a safe unavailable response; it does not count as `ALLOW`.
- **Main Agent:** uses the configured main model, chooses exact lookup versus search through tool calling, and produces the structured answer. No separate router or autonomous security agent. Only this stage invokes read tools.
- **Output Guard:** no LLM, no model repair loop. Validate schema/block types and sizes, source IDs against evidence returned in this turn, canonical site links, and structured status fields against returned records. Contact actions are constructed from trusted contact data under an explicit allowlist. Never render raw model HTML, arbitrary UI code or embedded images.
- Repair means deterministic removal of an invalid optional source/link/block; replace means a fixed safe response when required data or answer validity fails. A repaired response is validated again; if removing evidence leaves a claim unsupported or changes its meaning, replace the whole response. Do not claim schema validation proves prose grounding, catches every secret, or detects every overstated competence claim; those are also eval/human-review responsibilities.
- System instructions, tool results and visitor text remain distinct. Tool results, retrieved passages and conversation history are untrusted data. Validate tool arguments before execution and size/schema/source-check results before adding them to model context. No arbitrary HTTP destinations, file/shell execution, database operations or tools from `mcp-admin`.
- The input classifier does not cover indirect injection arriving later through tools. Read-only capabilities, evidence handling, output validation and adversarial evals cover this boundary together; none proves absolute injection resistance.

Generation instructions, each backed by evals: answer from returned evidence; admit missing information and offer contact; separate evidence from inference; preserve built/tested/designed status; speak as the assistant, not Petr; stay within the portfolio's scope.

### Models

| Role             | Initial candidate  | Effort   | Purpose                                           |
| ---------------- | ------------------ | -------- | ------------------------------------------------- |
| Security Gateway | `claude-haiku-5-5` | `medium` | Classify the bounded input; no tools              |
| Main Agent       | `claude-haiku-5-5` | `high`   | Evidence-backed answers and bounded read-tool use |
| Output Guard     | None               | None     | Deterministic validation and safe replacement     |

- This is an evaluated starting configuration, not a claim that Haiku already meets the requirements. Compare Main at Haiku `medium` and Sonnet 5.5 `medium` on a bounded common subset; choose the production candidate from measured quality, cost and latency. A change requires a recorded owner decision and fresh affected evals; do not silently switch models or lower a gate.
- Keep adaptive thinking enabled, bound total output including thinking, and record exact model identifier, effort, prompt/tool versions and pricing version. Use a dated snapshot when the provider offers one; do not invent a snapshot identifier. Pin integration/tool versions at implementation.
- Start with the Anthropic integration. OpenAI remains a supported architectural option, not a second mandatory paid baseline or an automatic fallback. No automatic cross-model fallback is enabled initially.
- Model IDs, effort, capability requirements and stage limits are validated configuration, never instructions controlled by visitor/model text. Current references checked on 2026-11-19: [Haiku](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [pricing](https://platform.claude.com/docs/en/about-claude/pricing).

- LangChain's model interface provides OpenAI/Anthropic integrations; LangGraph provides orchestration. Select security/main models through validated configuration. No separate LiteLLM proxy or handwritten provider clients initially.
- `models/gateway.py` owns stage selection, capability checks (tools, structured output, streaming), usage normalization and the application's reliability policy. Provider-specific files are added only for a demonstrated gap in the existing integration.
- Both stage models and any fallback must pass their relevant suites. Compare quality, latency and cost before changing provider, model, prompt or tool configuration. Prompt/model/pipeline versions are recorded with every attempt.

### Reliability and context

- Enforce stage/request token and cost allowances before every model attempt; include classifier, main calls, retries and fallback in one bounded execution allowance.
- Bound tool calls, iterations, result sizes and total wall-clock time. Preserve instructions, complete tool-call/result pairs and source references when trimming older complete turns.
- Centralize retries; disable overlapping provider/graph retries. Retry only eligible transient failures within the same deadline/allowance. No autonomous expansion of limits or unbounded model repair loop.
- Propagate cancellation through graph/model/tool calls, stop scheduling work and return measured or uncertain usage. A provider may still charge after cancellation; the API in phase 7 reconciles it conservatively.
- Typed outcomes distinguish refusal, unavailable classifier/provider/tool, invalid output, cancellation, deadline and budget exhaustion. Infrastructure failure is never relabelled as an allowed security verdict.
- The package accepts bounded history; it does not store visitor memory or summarize it with an additional LLM. Knowledge memory about Petr is the later retrieval/graph/ontology capability, not a second chat-history system.
- Buffer the draft until Output Guard succeeds. Progress events may precede approved content; unapproved model tokens cannot enter a public response.

### Initial execution limits and async behaviour

These owner-agreed defaults are configurable and measured, not already achieved performance. Never raise them automatically to make a run pass. Tightening within a caller's granted allowance is allowed; raising a frozen release limit or lowering a quality threshold needs an explicit reviewed decision.

| Limit                                                             | Default                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Whole attempt, including admission wait, tools, retries and guard | 60 seconds                                                                              |
| One security-model attempt                                        | 8 seconds, bounded by the remaining deadline                                            |
| One main-model attempt                                            | 25 seconds, bounded by the remaining deadline                                           |
| One API read tool                                                 | 5 seconds, bounded by the remaining deadline                                            |
| Main-model decisions                                              | 3 logical calls: up to two tool rounds and a final answer                               |
| Retry allowance                                                   | 1 additional model attempt for the entire execution, not per stage                      |
| All model attempts                                                | 5 maximum, including security and the one possible retry                                |
| Tool invocations                                                  | 6 total, at most 3 independent reads concurrently                                       |
| Current question                                                  | 1,000 tokens; reject oversize input rather than silently changing its meaning           |
| Selected history                                                  | Up to 6 complete visitor/assistant exchanges and 6,000 tokens; either limit may trim it |
| Input to one main-model call                                      | 16,000 tokens including instructions, tool definitions, history, question and evidence  |
| Output from one main-model call                                   | 8,192 tokens including thinking, tool arguments and visible content                     |
| Security input / output                                           | 4,000 / 768 tokens; output includes thinking                                            |
| Input across all model attempts                                   | 80,000 tokens, counting repeated context and retries                                    |
| Output across all model attempts                                  | 16,384 tokens, including thinking and retries                                           |
| Initial Haiku execution allowance                                 | USD 0.02 for the whole attempt                                                          |

- Allocate a main-input envelope of up to 4,000 tokens for instructions/tool definitions, 6,000 for history, 1,000 for the question and 5,000 for current tool evidence. Validate the complete serialized input before each call; retain source identity and tool-call/result pairing when reducing context. Reject unusable tool results rather than presenting truncation as complete data. The implementation may redistribute unused space within 16,000 tokens without raising any other cap.
- The security context prioritizes its policy, the complete current question and newest complete history exchanges within 4,000 tokens. History/tool evidence is untrusted. `UNCERTAIN` uses at most 2 main decisions, 3 tools and 3,000 history tokens within the same overall allowance; no broader capabilities are granted.
- Every attempt is admitted only if its input, configured maximum output, remaining deadline and conservatively priced cost fit all remaining allowances. Set the provider output ceiling to the remaining aggregate budget. Classifier failure after any eligible retry ends in unavailable, never implicit allow. If the last permitted decision requests more tools, stop with a typed limit outcome; do not add an unbudgeted final model call.
- At the checked Haiku short-context rates (USD 0.10 input / 0.50 output per million tokens), 80,000 input plus 16,384 output is about USD 0.0162. USD 0.02 is an initial allowance with margin, not a provider billing guarantee. Count overhead conservatively and treat unknown post-cancellation usage as uncertain; reprice or reduce limits when models/prices change.
- A normal visible answer aims for 150–300 words. The output cap also reserves thinking and structured data; it is not a target answer length. Measure p50/p95 and target p95 approved-content latency of at most 20 seconds on the versioned representative local eval workload, recording hardware, concurrency and provider settings. Failure meets a stable deadline/limit outcome, not a partial unapproved draft.
- Make the package operation async from graph through model and API transport; no blocking HTTP client, synchronous sleep, or CPU-heavy work on the request event loop. Multiple independent executions have isolated state; cancellation of one must not cancel another. Only independent read calls may run concurrently; Security, Main and Output retain their dependency order.
- Phase 7 owns HTTP admission: one async generation process, 4 admitted chat executions, a bounded wait of at most 2 seconds, and one active turn per conversation. API and AI service run as separate services; multiple processes/replicas are not needed for remote I/O and must not multiply a process-local limit silently. CPU work or later ingestion has its own future design.
- The owner approved a USD 20 calendar-month runtime ceiling, enforced durably by the API in phase 7, and a separate USD 10 initial evaluation campaign ceiling including reference models and model graders. Phase 6's runner enforces the evaluation allowance locally; it does not build durable runtime spend storage. After exhaustion, use a fixed contact/limit response with no model call.

### Website blocks

- Reuse the phase-3 typed event/block contract through generated models/adapters. Contact, experience, service, exploration, roadmap and source blocks are data rendered by the website's own components in phase 7.
- This phase has no website or external-client UI implementation. MCP Apps is phase 13.

### Evals and acceptance

The [evaluation specification](evals.md) defines a target catalogue of 80 bilingual end-to-end scenarios (40 EN / 40 CS), component coverage, grading rubrics and fixed initial gates. It is a plan, not implemented tests or a passing baseline. Add cases before the relevant component; pending cases are visible and never count as passed. All phase-6 catalogue cases must be implemented and evaluated before phase acceptance; future RAG cases are separate phase-9 work.

- pytest covers deterministic contracts, state transitions and failures with fake providers in ordinary CI. Promptfoo is the single offline model-eval runner; code, model and human grading are all required.
- During an issue, run only affected paid cases, with 3 repeats per case, and report their IDs, scope, gate and measured cost. A shared model/prompt/security/tool/context change may affect the whole catalogue; selection must be justified, not just minimized. A partial gate is not a full release gate.
- Extend the existing `Model evals` workflow with the Python suite during implementation, as its own job with its own paths (`packages/llm-agent/` and what can change its behaviour): the full phase catalogue runs on the phase pull request into `master` when that pull request is opened, reopened or marked ready for review and changes one of those paths, or by explicit manual dispatch; not on issue PRs into the phase branch and not on every push (new commits start no charged run; the owner starts another by hand). Only affected suites run (`docs/testing.md`, Evals-driven development). Do not run a complete multi-provider comparison on every CI event.
- Reuse the phase-5 policy from [PR #173](https://github.com/sebelapetr/sebela.dev/pull/173): persist credential-scanned fictional answers/tool traces locally, support explicit case selection and no-generation regrading. Fixes to deterministic graders regrade stored compatible runs first; changes to generation inputs require fresh answers. Changing a model grader can incur paid judging calls and consumes the eval budget even when generation is reused.
- Reuse [PR #171](https://github.com/sebelapetr/sebela.dev/pull/171)'s `node harness/with-secrets.mjs -- <command>` wrapper for the Python runner. Worktrees contain no copies of owner provider secrets; CI injects its repository secret into the eval step only. Keep regular tests and configuration checks credential-free. Missing credentials block paid verification, never produce a fake pass.
- Code gates and all critical model case-runs must pass completely. Initial quality floors are 90% useful ordinary answers per language, 95% semantically supported citations, and no more than 5% falsely blocked legitimate questions per language. Denominators, rubric versions and sample sizes accompany every report. Baselines diagnose weaknesses; they do not lower these floors.
- At the phase PR, the owner reviews 12 recorded answers (6 EN / 6 CS), plus all ambiguous/disputed results, scores them under the versioned rubric and records acceptance. PR approval is the final decision only when it links to that evidence; an approval click alone is not a human score and never waives a failing safety gate. Phase 6 does not require Langfuse hosting or an annotation UI.
- Confirmed production failures later become fictional regression cases after human review. Never commit real visitor messages or owner data.

### Observability

- Hide tracing behind a small package entry. Record stage/model/tool spans, versions, latency, usage, cost and final outcome. Redact credentials; payload capture is explicit.
- Phase 6 can use an in-memory/export-disabled sink. Phase 7 chooses the Langfuse deployment and connects runtime traces; telemetry failure cannot change a safety decision or execution limit.

### Python layout and tooling

```text
packages/llm-agent/
  AGENTS.md
  package.json                  # pnpm/Turbo task wrappers; Python metadata stays below
  pyproject.toml
  src/llm_agent/
    __init__.py                 # documented public operation/contracts
    runner.py                   # local runner; no HTTP server
    generated/content_api/      # generated models/client; no handwritten business logic
    pipelines/chat/
      graph.py
      state.py
      stages/
        security_gateway.py
        main_agent.py
        output_guard.py
    models/
      gateway.py
      config.py
      usage.py
    tools/
      registry.py
      permissions.py
      content.py                # public-read adapter; source references
    guardrails/
      input.py
      output.py
      policies.py
    reliability/
      retries.py
      timeouts.py
      budgets.py
    context/
      history.py
      tokens.py
    observability/
      tracing.py
      telemetry.py
    evaluation/
      scoring.py
    prompts/
      security.py
      chat.py
    schemas/
      requests.py
      responses.py
  tests/unit/
  tests/integration/
  evals/
    promptfooconfig.yaml
    datasets/
    graders/
```

- This is the approximate responsibility/file map, not an instruction to create empty abstractions. Add explicit Python package entries where needed and keep helper files private. `llm_agent` is the import root, not `src`. Keep generated API transport separate from handwritten tool policy.
- **uv** manages Python, dependencies and environments; use project metadata and a committed lockfile, with `uv sync --locked` in CI. Establish a uv workspace for the existing approved Python package and add the phase-7/8 apps when delivered; keep one lockfile at the workspace root. Select/pin a supported Python minor and compatible stable tool/integration versions during the initial setup; do not add future apps now.
- **Ruff** is both formatter (`ruff format`) and linter (`ruff check`), with explicit import-sorting, unused-import, bugbear and async checks as appropriate. No separate Black, isort, autoflake or Flake8. CI checks without silently fixing files.
- **mypy** is the one required type checker, in strict mode with `pydantic.mypy`; **pytest** is the deterministic test runner. No editor or Pylance dependency. Configuration and exceptions for generated code are documented; do not hide handwritten boundary errors with blanket ignores.
- Pydantic defines stage contracts; LangGraph orchestrates; LangChain provider integrations own model transport. Promptfoo runs model evals. Add package-local `AGENTS.md`, task wrappers, generated drift checks, hooks/CI coverage and the commands in code standards during implementation. No Python app Dockerfile or server port is required in phase 6.

## Testing Decisions

- Evals and their release thresholds precede each model-dependent component; the owner approves expected behaviour. Fake providers support deterministic ordinary CI.
- Test transitions for allow/block/uncertain/classifier failure, bounded tool loops, argument/result validation, schema/evidence/link/status checks, deterministic repair and fallback.
- Test token/context/deadline/cancellation/retry limits, including malformed or oversized tool evidence and no delivery of an unapproved draft.
- Contract-test generated API reads against a test API; never give Python Postgres access.
- Demonstrate a complete local question -> structured tools -> approved answer with sources, both with fakes and an explicitly budgeted real-model run.

## Out of Scope

- FastAPI, public MCP, live web chat, conversation persistence and durable global spend admission (phases 7–8).
- RAG/indexing/extra-document ingest (phase 9), graph (11), ontology (12), external MCP UI (13).
- Redis, Kafka, Temporal, workers, a model proxy, multi-agent orchestration or distributed concurrency infrastructure.

## Further Notes

- The owner agreed to the initial models/effort, numeric limits, tooling and eval floors on 2026-11-19. Implementation measures them and records any later approved changes. This PRD update creates no pipeline, eval runner or paid run.
- Run and explain one complete bounded pipeline before adding a service around it.
