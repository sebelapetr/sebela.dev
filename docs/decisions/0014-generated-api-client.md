# 0014 — The API client is generated with openapi-typescript and openapi-fetch

Status: accepted
Date: 2026-11-16

## Decision

- `@sebela/api-client` is generated from the API's OpenAPI 3.1 document. `@sebela/api` exports the document from its source (`describeApi()`, `openapi:export`) without a database, configuration or secrets; it is committed as `packages/api-client/src/generated/openapi.json`.
- openapi-typescript (pinned, development only) generates `paths` and `components` types from it into `src/generated/schema.ts`, with `--default-non-nullable false` so that fields with a default stay optional in write bodies. openapi-fetch (pinned) is the runtime: a thin typed `fetch` wrapper.
- `createApiClient` adds the API key as a bearer token through an openapi-fetch middleware, only to operations whose `security` in the committed document is non-empty. Results are `{ data, error, response }`; HTTP failures do not throw.
- A plain Node check (`scripts/checks/generated-drift.mjs`) regenerates the committed files and fails on any changed, added or removed file; CI runs it on every change (`pnpm check:api-client`). A route-changing pull request regenerates the client and extends the consumer contract tests.
- Python consumers (phase 7) generate from the same committed document with a pinned openapi-python-client; nothing is scaffolded now.

## Why

- The API builds its document from the Zod 4 schemas of `@sebela/contracts` with zod-openapi, and serves it from Hono; the client must not depend on either. Any OpenAPI generator can read the result, so the choice does not tie the API to one client library. Generating from the document keeps consumers on the contract, not on the server's source or framework types.
- openapi-typescript emits only types, which compile under the repository's strict TypeScript configuration (`exactOptionalPropertyTypes`, no DOM library) without relaxing it. The runtime is a small dependency rather than vendored generated code.
- Bearer injection by the documented security keeps the key away from public reads without a path heuristic, and each client keeps its own key with no global state.
- Output is deterministic: the same routes and schemas give the same document, serialized as two-space JSON, and the generator is pinned, so a drift check can compare files byte for byte.
- `{ data, error, response }` makes documented failures — validation, not found, conflict, authentication, rate limit with `Retry-After` — ordinary typed values for the caller.

## Rejected

- **Hey API (`@hey-api/openapi-ts`)**: its fetch client is always vendored into the output (the separate client package is deprecated), and that code fails the shared strict TypeScript configuration (`exactOptionalPropertyTypes`, the DOM-only `BodyInit`). Accepting it would mean loosening compiler checks for generated code.
- **orval** and **Kubb**: full code generators with many plugins (query hooks, mocks, validators) the project does not need; more generated code to keep under the strict configuration for the same typed `fetch` calls.
- **Hono RPC (`hc`)**: the client would import the API's server types, which breaks the rule that consumers depend on the contract, not the API's source, and gives Python nothing.
- **A handwritten client**: drifts silently from the document; the point of the slice is that drift fails CI.
