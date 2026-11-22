# @sebela/api-client-python

The Python client of the content API (import name `sebela_api_client`), generated from the same OpenAPI document as the TypeScript client. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A library for the Python members of the repository: `packages/llm-agent` now, `apps/ai-service` later in phase 7. It is a member of the root uv workspace (distribution name `sebela-api-client`); its `package.json` holds only the pnpm task wrappers. It depends on nothing in this repository: its code is generated from the committed contract `packages/api-client/src/generated/openapi.json`, never from the API's source, and it has no database access.

**Never edit it by hand.** Everything under `src/sebela_api_client/` is written by the `generate` script. A change to the API's routes or contract schemas is picked up by regenerating, not by editing.

## Access

The package keeps the **complete** generated client: every route and model of the contract, private write operations included (the owner's decision of 2026-11-21, `docs/threat-model.md`). It is plain generated code and decides nothing about access:

- It holds no credential and no default base URL. Every consumer constructs `Client(base_url=...)` with an address from its own environment; `AuthenticatedClient` exists because the generator writes it, and nothing in the repository constructs it with a content-write key.
- Each consumer keeps its own handwritten allowlist of the operations it may call, and only that module imports this package. In `packages/llm-agent` that is `llm_agent.tools.content`, which calls only the public read routes the agent uses and sends no credential (plus the eval harness's fixture check, which reads `GET /v1/person`). The agent's use stays limited to those public reads; the write operations of this package are never called by the agent. `apps/ai-service` adds its own adapter later in this phase.
- Keeping write operations here is the accepted risk: they sit one import away from a consumer. The mitigation is that a consumer depends on this package explicitly and imports it in one reviewed module.

## Generation

| Task                                                          | Command (from the repository root)                 |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Export the OpenAPI document and regenerate both API clients   | `pnpm generate:api-client`                         |
| Check that the committed clients match a regeneration (CI)    | `pnpm check:api-client`                            |
| Only regenerate the Python client from the committed contract | `pnpm --filter @sebela/api-client-python generate` |

- **Tool.** openapi-python-client 0.30.0, pinned with Ruff in the `dev` group of `pyproject.toml` and run through uv (`uv run --locked`).
- **How it runs.** The `generate` script runs it with `--meta none --config content-api-client.yaml --output-path src/sebela_api_client --overwrite`, then writes the `py.typed` marker (PEP 561) that `--meta none` leaves out, so consumers' mypy reads the client's signatures. The configuration's post hooks format the output with Ruff's defaults (`--isolated`), so the files are byte-identical everywhere.
- **Drift.** `pnpm check:api-client` (`scripts/checks/generated-drift.mjs`) fails when `src/sebela_api_client/` differs from a regeneration; the quality job of CI runs it on every change.
- **Checks.** Ruff excludes the generated folder (`pyproject.toml`); a consumer's mypy skips its bodies (`ignore_errors` for `sebela_api_client.*`) and types its own callers against the signatures. The root `.gitattributes` marks the folder `linguist-generated`.

## Module map

Not a backend module layout: a generated client keeps its native placement (`docs/repository-structure.md`, Backend module layout).

| Path                                          | Responsibility                                                                    | Tests                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/sebela_api_client/client.py`             | `Client` and `AuthenticatedClient` over `httpx2`; the consumer sets the base URL. | drift check; `packages/llm-agent/tests/` through its allowlist            |
| `src/sebela_api_client/api/`                  | One module per operation of the contract (`sync`/`asyncio`, `*_detailed`).        | drift check; `packages/llm-agent/tests/integration/` against the real API |
| `src/sebela_api_client/models/`               | The contract's schemas as attrs classes with `from_dict`/`to_dict`.               | drift check; `packages/llm-agent/tests/`                                  |
| `src/sebela_api_client/types.py`, `errors.py` | `Response`, `UNSET` and the generator's error types.                              | drift check                                                               |

## Tests

The package has no tests of its own: its behaviour is observed through its consumers' tests (`packages/llm-agent/tests/unit/test_content_reader.py` with an in-memory transport, `tests/integration/test_content_api.py` against the real API), and its files through `pnpm check:api-client`. It has `build` and `generate` tasks only; there is no handwritten code to lint or typecheck.
