# llm-agent

The reusable portfolio chat agent: a Python library that answers one visitor question at a time with a guarded, bounded, bilingual (EN/CS) answer over public content reads. Read the root `AGENTS.md` first; this file covers only what is specific to this package. The phase PRD is `.plan/06-llm-agent/prd.md`, and the eval specification is `.plan/06-llm-agent/evals.md`.

## What it is

- **A library, not a service.** There is no FastAPI app, no MCP server, no port and no Dockerfile. `apps/ai-service` (phase 7) and `apps/mcp-public` (phase 8) will wrap it.
- **Public content only.** Content comes over HTTP from the API's public read routes, through a handwritten allowlist on top of the generated client. Python never imports `@sebela/services` or `@sebela/db` and never reaches Postgres. It holds no content-write key and sends no `Authorization` header.
- **Three stages in one LangGraph flow:**
  - Security is Claude Haiku 5.5 at `medium` effort. It classifies the question as ALLOW, BLOCK or UNCERTAIN.
  - Main is Claude Haiku 5.5 at `high` effort. It answers through the read tools.
  - Output Guard is deterministic code with no model. It validates sources, links and blocks, and it repairs or replaces the draft.
- **Nothing reaches the caller before the Output Guard approves it.** A classifier failure counts as unavailable. It never counts as allow.

## Public interface

Only the root package `llm_agent` (`src/llm_agent/__init__.py`) is public. Every other module is private to the package.

| Export                                                                                                                          | What it provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatAgent(content=, models=).run(request, *, limits=None, cancel=None)`                                                        | The one operation. It always returns a `ChatResult` and never raises for a model, content, limit or cancellation failure. Each failure becomes a fixed EN/CS response with a stable `reason`. Outcomes: `answered`, `insufficient_evidence`, `refused`, `unavailable`, `cancelled` and `limit_reached`. Each run owns its own budget, deadline, evidence and trace.                                                                                                                                                                                                             |
| `ChatRequest`, `ChatResult`, `ExecutionLimits`, `Source`, `Evidence`, `ContactCard`, `ContactLink`, `Usage`, `Span`, `Versions` | The Pydantic contracts. `ChatResult` carries the approved text, the current-turn `sources` (record id and allowed `href`), the typed `blocks`, the trusted `contact` card when the answer points to it, `usage` (tokens, attempts, retries, cost and whether the cost is uncertain), the redacted trace and the version identifiers. A caller may lower any `ExecutionLimits` cap but never raise one.                                                                                                                                                                          |
| `Block`, `ExperienceCard`, `ServiceCard`, `ExplorationCard`                                                                     | The typed structured blocks of an answered result (at most 3). Output Guard builds each one in code from a cited record of this turn; the model never writes block fields. The fields match the chat contract's `experience`, `service` and `exploration` blocks, so phase 7 maps them without a second schema. An exploration card keeps its `built`/`tested`/`designed` status.                                                                                                                                                                                               |
| `ContentReader`, `ApiContentReader(base_url)`, `ContentUnavailableError`, `ContentNotFoundError`, the `Public*` read models     | The read boundary. `ApiContentReader` is an async context manager over the generated client. It reads only the public routes `GET /v1/person`, `/v1/experiences`, `/v1/projects`, `/v1/projects/{slug}`, `/v1/explorations`, `/v1/services` and `/v1/education`, and returns only the public fields the tools use (`PublicPerson`, `PublicExperience`, `PublicProject`, `PublicExploration`, `PublicService`, `PublicEducation` and their parts). A 404 on a project raises `ContentNotFoundError`; any other status, a bad body or a timeout raises `ContentUnavailableError`. |
| `ModelFactory`, `ChatModel`, `ModelCall`, `anthropic_model_factory()`                                                           | Model transport. The production factory builds the pinned LangChain Anthropic models. Tests pass scripted fakes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `versions()`                                                                                                                    | Identifiers of the pipeline, the models and efforts, and the prompt, tool and Output Guard hashes. The eval fingerprint is built from them.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Limits** (`ExecutionLimits`, approved 2026-11-19):

- Deadline: 60 s for the whole execution. Each Security attempt may take 8 s, each Main attempt 25 s, and each tool call 5 s.
- Retries: one retry for the whole execution, out of at most 5 model attempts.
- Tokens: a question may have at most 1,000 tokens.
  - Security: 4,000 in, 768 out.
  - Main: 16,000 in, 8,192 out.
  - Execution total: 80,000 in, 16,384 out.
- Cost: USD 0.02.
- Main: 3 decisions and 6 tool calls. Under UNCERTAIN this drops to 2 and 3.
- A tool result may have at most 5,000 tokens; a larger one is rejected.
- All tool results of one execution may add at most 10,000 tokens to the model context, and a list result may carry at most 30 records. Anything over either cap is rejected, never truncated, and adds no evidence.
- At most 3 independent reads run at the same time. A repeated read within one execution reuses its first result.

Retries are centralised in `reliability/retries.py` and are bounded by these limits. Cancellation is an `asyncio.Event` passed to `run`.

## Commands

Run them from this folder, or through pnpm from the root (`pnpm --filter @sebela/llm-agent <task>`). uv is the only Python tool. Never use `pip`, `python -m venv` or a system Python.

| Task                                                      | Command                                                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install the locked environment (from the repository root) | `uv sync --locked --all-packages`                                                                                                                                                                   |
| Format check and lint                                     | `pnpm lint` (`ruff format --check`, then `ruff check`)                                                                                                                                              |
| Typecheck                                                 | `pnpm typecheck` (mypy strict with the Pydantic plugin, over `src`, `evals` and `tests`)                                                                                                            |
| Tests                                                     | `pnpm test` (pytest, unit and integration). Turborepo builds `@sebela/api` first. The integration tests start the API's e2e server on a temporary database and need the worktree's running Postgres |
| Build the wheel and sdist                                 | `pnpm build` (writes `dist/`)                                                                                                                                                                       |
| Regenerate the content client                             | `pnpm generate:api-client` from the root, which also regenerates the TypeScript client. Only this package: `pnpm generate`                                                                          |
| Ask one question locally (paid)                           | `LLM_AGENT_API_URL=<public API base URL> node ../../harness/with-secrets.mjs -- uv run --locked python -m llm_agent.runner "<question>"`                                                            |
| Model evals (paid; see below)                             | `pnpm --silent eval --allowance <remaining USD> --case <id> [--case <id> ...]`                                                                                                                      |
| Regrade a stored run without new answers (free)           | `uv run --locked python -m evals.run --regrade ../../.tmp/evals/llm-agent/<run>`                                                                                                                    |
| Start and read the fictional eval fixture (free)          | `uv run --locked python -m evals.run --check-fixture`                                                                                                                                               |

**Configuration:**

- The runner reads only `LLM_AGENT_API_URL`, from the process environment. Nothing else reads environment files, and nothing hard-codes a host or port.
- The evals and integration tests start their own API. They read the worktree's Postgres settings (`POSTGRES_HOST`, `POSTGRES_PORT`, `DATABASE_NAME`, `DATABASE_USER` and `DATABASE_PASSWORD`) in the same way as the backend tests. Turborepo passes these settings through to `test`.
- The model key reaches only commands run through `harness/with-secrets.mjs`.

**Toolchain:**

| Tool                  | Version | Pinned in                                       |
| --------------------- | ------- | ----------------------------------------------- |
| Python                | 3.13    | `.python-version` and `requires-python`         |
| uv                    | 0.7.22  | `required-version` in the root `pyproject.toml` |
| Ruff                  | 0.17.6  | this package's `pyproject.toml`, dev group      |
| mypy                  | 2.4.1   | this package's `pyproject.toml`, dev group      |
| pytest                | 9.2.0   | this package's `pyproject.toml`, dev group      |
| openapi-python-client | 0.30.0  | this package's `pyproject.toml`, dev group      |

The rest of the toolchain:

- The runtime dependencies (`anthropic`, `attrs`, `httpx2`, `langchain-anthropic`, `langchain-core`, `langgraph`, `langsmith` and `pydantic`) are exact pins. `langsmith` is pinned directly because `ChatAgent` switches its tracing off for every run.
- `uv.lock` at the repository root records everything.
- The generated client is excluded from Ruff, and mypy ignores errors inside it. Its signatures still type the handwritten callers.

## Module map

The responsibility folders follow the PRD's approximate map. Files are added only where there is a responsibility to hold.

| Module                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tests                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `__init__.py`              | The public operation and contracts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `tests/unit/test_chat_agent.py`                                                              |
| `pipelines/chat/`          | `ChatAgent`: the per-run execution, the deadline and cancellation race, and the LangGraph flow (`graph.py`, `state.py`) with its three stages. The stages are `stages/security_gateway.py`, `stages/main_agent.py` and `stages/output_guard.py`. `versions.py` holds the version identifiers, including a fingerprint of every package module.                                                                                                                                                         | `tests/unit/test_chat_agent.py`, `tests/integration/`                                        |
| `models/`                  | `config.py` validates the stage model settings. `gateway.py` builds the LangChain Anthropic models, applies the attempt, token and cost caps, retries and the deadline, and calls models. `usage.py` holds the cost and pricing table. `replies.py` parses structured replies.                                                                                                                                                                                                                         | `tests/unit/test_chat_agent.py`                                                              |
| `tools/`                   | `content.py` is the public-read adapter (`ContentReader`, `ApiContentReader`) over the generated client. `registry.py` holds the eight read tools: `get_profile`, `get_contact`, `list_experiences`, `list_projects`, `get_project` (by slug), `list_services`, `list_explorations` and `list_education`. It validates their arguments and results, caps their size, time, total context and concurrency, assigns source refs with canonical site links, and builds the typed blocks of cited records. | `tests/unit/test_content_reader.py`, `tests/unit/test_career_tools.py`, `tests/integration/` |
| `guardrails/`              | `input.py` detects the language. `output.py` validates sources, links, blocks and the contact card, and repairs or replaces a draft. `policies.py` holds the fixed EN/CS outcomes.                                                                                                                                                                                                                                                                                                                     | `tests/unit/test_chat_agent.py`                                                              |
| `reliability/`             | `budgets.py` (tokens, cost and attempts), `timeouts.py` (the deadline), `retries.py` (the one bounded retry policy) and `stops.py` (the stop reasons).                                                                                                                                                                                                                                                                                                                                                 | `tests/unit/test_chat_agent.py`                                                              |
| `context/tokens.py`        | A conservative token estimate for questions and tool results.                                                                                                                                                                                                                                                                                                                                                                                                                                          | `tests/unit/test_chat_agent.py`                                                              |
| `observability/tracing.py` | The in-memory trace: `stage.*`, one `model.<stage>` span per attempt (model, effort, attempt, tokens) and `tool.*`/`guard.*` spans. It is redacted and has no exporter; LangSmith tracing is forced off, whatever `LANGSMITH_TRACING` says.                                                                                                                                                                                                                                                            | `tests/unit/test_chat_agent.py`                                                              |
| `prompts/`                 | The Security and Main system prompts. Their hashes are part of `versions()`.                                                                                                                                                                                                                                                                                                                                                                                                                           | evals                                                                                        |
| `schemas/`                 | The request and response contracts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `tests/unit/`                                                                                |
| `runner.py`                | The local command-line runner. It prints one result as JSON and has no server.                                                                                                                                                                                                                                                                                                                                                                                                                         | manual (paid)                                                                                |
| `generated/content_api/`   | The client and models generated from `packages/api-client/src/generated/openapi.json` (`content-api-client.yaml`). Never edited by hand. The drift check covers it.                                                                                                                                                                                                                                                                                                                                    | `pnpm check:api-client`, `tests/integration/`                                                |

Not created in this slice, because no behaviour needs them yet:

- `tools/permissions.py`: the eight read tools of `registry.py` are the whole allowlist.
- `context/history.py`: there is no conversation history before phase 7.
- `observability/telemetry.py`: phase 7 chooses the exporter.
- `evaluation/scoring.py`: scoring and the gate live in `evals/`, because they are offline eval code and not runtime code.

## Evals

The evals live in `evals/`:

- `catalogue.py` lists all 80 planned case IDs as implemented or pending.
- `datasets/` holds the cases and the fictional fixture.
- `graders/` holds the code graders (`code.py`), the Promptfoo assertion adapter (`assertion.py`) and the Sonnet rubric (`rubric.py`).
- `gate.py` applies the gates.
- `budget.py` keeps the campaign ledger.
- `run.py`, `provider.py` and `promptfooconfig.yaml` hold the runner. Promptfoo drives the cases.

Gates (`.plan/06-llm-agent/evals.md`):

- Every critical case passes in 100% of its repeats.
- Useful ordinary answers reach at least 90%, separately for EN and CS.
- Supported citations reach at least 95%.
- False blocking is at most 5% per language.
- Every case runs 3 independent repeats.

Policy:

- **Which cases run.** An issue runs only the cases it affects: `--case` per ID, 3 repeats each.
- **Grader fixes.** A deterministic grader fix is checked with a free `--regrade`.
- **Model judging.** A changed rubric is judged again with `--regrade <run> --judge --allowance <usd>`. That is paid and charged to the campaign.
- **When answers become incompatible.** The dataset version hashes only what the agent sees (question, language, fixture and allowed tools). Changing an expectation keeps stored answers regradable. The subject versions include a `runtime` fingerprint of every module of `src/llm_agent/` and the `pricing` version, so any change to the package code (a prompt, a model setting, a guard rule, a tool projection) needs fresh answers. A dependency upgrade in `uv.lock` is not fingerprinted: bump the package version with it.
- **Budget.**
  - The initial campaign ceiling is USD 10 cumulative.
  - Every paid command declares the remaining allowance. The local ledger (`.tmp/evals/llm-agent/ledger.json`) also caps it.
  - Unmeasured cost consumes its whole reservation.
  - A missing key or an exhausted allowance is a visible block (exit 2), never a pass.
- **CI.** The job `Python agent model evals` of `model-evals.yml` runs `--all` on the phase pull request into `master`, or on manual dispatch. Its allowance comes from the dispatch input or the repository variable `LLM_AGENT_EVAL_ALLOWANCE_USD`. A CI runner has no ledger, so after every run the owner sets that variable to the remainder the job log names (the notice `llm-agent eval allowance`), or the next run could spend the same allowance again. It uploads only the redacted `summary.json`, which also reports the latency p50 and p95 of the case-runs.
- **Storage.** Answers stay in the git-ignored `.tmp/evals/llm-agent/`, written only after a credential scan.

### Baseline (issue #178, 2026-11-20)

The first implemented slice has 12 cases × 3 repeats: Q01, Q14, S01, S08, S11 and S19, each in EN and CS. The scope is partial, because 68 cases are still pending.

| Item                 | Value                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject              | pipeline `chat-1`; Security `claude-haiku-5-5` `medium`, Main `claude-haiku-5-5` `high`, Output Guard `output-guard-2+b761d86edfe7`; chat prompt `5cc2ad0165d4`, security prompt `51533f9e64b1`, tools `db661e4d0e89`, runtime `09da911ddaa9`, pricing `anthropic-2026-11-19`                                                                      |
| Dataset              | `profile-v1-ac93e67c6769`                                                                                                                                                                                                                                                                                                                          |
| Judge                | `claude-sonnet-5-5` `medium`, `rubric-v2`, pricing `anthropic-2026-11-19`                                                                                                                                                                                                                                                                          |
| Answers              | run `run-20261120T121452Z-2362664`, answered and judged in one run                                                                                                                                                                                                                                                                                 |
| Result               | **PASS.** Critical 24/24. Useful EN 6/6, CS 6/6. Supported citations EN 6/6, CS 6/6. False blocking EN 0/6, CS 0/6                                                                                                                                                                                                                                 |
| Latency              | p50 2439 ms, p95 7581 ms over 36 case-runs                                                                                                                                                                                                                                                                                                         |
| Cost of the baseline | USD 0.0797: USD 0.0143 for the answers and USD 0.0654 for judging                                                                                                                                                                                                                                                                                  |
| Campaign so far      | USD 0.2992 of USD 10. This includes the first `output-guard-1` baseline (USD 0.1394) and two earlier runs that found a grader false positive and an unsupported contact claim; both were fixed with tests. The review then found that the guard passed an answer without sources; `output-guard-2` replaces it and the baseline was recorded again |

### Career and role-fit slice (issue #179, 2026-11-20)

Issue #179 adds Q02–Q07, Q15, Q16, S02, S03, S04, S06, S07, S10 and S20 in EN and CS. Its registry, prompt and Output Guard changes also affect the #178 cases (Q01, Q14, S01, S08, S11 and S19). That makes 42 cases × 3 repeats. A single run of all of them would reserve more than the USD 1.00 per-run limit, so they ran in slices. The answers of the slices on the final subject were then pooled into one folder and graded together with a free `--regrade`.

| Item              | Value                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subject           | pipeline `chat-1`; Security `claude-haiku-5-5` `medium`, Main `claude-haiku-5-5` `high`, Output Guard `output-guard-3+b761d86edfe7`; chat prompt `5cb5fd5b666e`, security prompt `51533f9e64b1`, tools `e741aa6ba122`, runtime `86db9bda13ac`, pricing `anthropic-2026-11-19`                    |
| Dataset           | `profile-v1-4d9c1ebf9fb2`                                                                                                                                                                                                                                                                        |
| Judge             | `claude-sonnet-5-5` `medium`, `rubric-v3`, pricing `anthropic-2026-11-19`                                                                                                                                                                                                                        |
| Answers           | runs `run-20261120T134122Z-2508443`, `-134251Z-2511042`, `-134426Z-2513689`, `-134553Z-2518672`, `-134820Z-2523436` and the first 15 case-runs of `-135402Z-2533397`; pooled regrade `run-20261120T135634Z-2538049`                                                                              |
| Result (25 cases) | **PASS** over Q01–Q07, Q14–Q16, S02, S03 (EN and CS) and S04-en. Critical 15/15. Useful EN 29/30, CS 30/30. Supported citations EN 70/72, CS 67/69. False blocking EN 0/30, CS 0/30                                                                                                              |
| Not yet run       | **S04-cs, S06, S07, S10, S20, S01, S08, S11 and S19 (EN and CS) have no answers on this subject.** The provider refused further calls (credit balance too low) during `run-20261120T135402Z-2533397`; those case-runs ended `unavailable` and are not counted. They must run before the phase PR |
| Latency           | p50 6986 ms, p95 15826 ms over 75 case-runs                                                                                                                                                                                                                                                      |
| Cost of the issue | USD 1.2931 in total. The answers on the final subject cost USD 0.6490. The rest went to earlier prompt versions whose failures led to the prompt fixes, and to a run cut off by a command timeout (USD 0.0874, of which USD 0.0600 is an unmeasured reservation)                                 |
| Campaign so far   | USD 1.5923 of USD 10                                                                                                                                                                                                                                                                             |

## Tests

- `tests/unit/` runs on scripted fakes at the model and content boundaries. It covers the following:
  - allow, block, uncertain and classifier failure;
  - provider 429 and 5xx responses;
  - invalid and oversized tool results;
  - repair and replace;
  - every cap, the deadline and cancellation;
  - two isolated concurrent runs;
  - that no unapproved draft is delivered.
- `tests/integration/` calls the generated client and the agent against the real API, which serves the fictional fixture on a temporary database.
- `tests/evals/` tests the eval code itself: the catalogue, the graders, the rubric, the gate, the budget and the runner. Paid calls are faked.

Pitfall: a module-scoped async fixture needs `@pytest_asyncio.fixture(scope="module", loop_scope="module")`, and its tests need `@pytest.mark.asyncio(loop_scope="module")`. Otherwise the fixture's event loop is closed under the test.
