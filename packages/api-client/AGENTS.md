# @sebela/api-client

The typed HTTP client of the content API, generated from its OpenAPI document. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A library for server-side TypeScript consumers of the API (the website's server code, the admin MCP server, the API's own consumer contract tests). It depends on nothing in this repository except `@sebela/config` for tooling (dependency table in `docs/repository-structure.md`): its types come from the committed OpenAPI document, never from the API's source, services, db or Hono. Why openapi-typescript and openapi-fetch: [decision 0014](../../docs/decisions/0014-generated-api-client.md).

## Public interface

Only the root export `@sebela/api-client` (`src/index.ts`) is public.

| Export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What it provides                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createApiClient({ baseUrl, apiKey?, fetch? })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A client for one base address. Methods per HTTP verb take the documented path (`client.GET("/v1/person")`) and return `{ data, error, response }`: the success body, the common `ErrorResponse` of a documented failure, and the response for status and headers (`Retry-After`). HTTP failures never throw; a network failure rejects. |
| `ApiClient`, `ApiClientOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The client type and its options. `ApiClient` is openapi-fetch's `Client<paths>`, so its method interface (`GET`, `POST`, `PATCH`, `DELETE`, `use`, the result shape) is part of this package's public contract; upgrading openapi-fetch is a contract change for every consumer.                                                        |
| `Person`, `PersonCreate`, `PersonUpdate`, `PersonLink`, `Technology`, `TechnologyList`, `TechnologyCreate`, `TechnologyUpdate`, `Topic`, `TopicList`, `TopicCreate`, `TopicUpdate`, `Organization`, `OrganizationList`, `OrganizationCreate`, `OrganizationUpdate`, `Experience`, `ExperienceList`, `ExperienceCreate`, `ExperienceUpdate`, `Project`, `ProjectList`, `ProjectCreate`, `ProjectUpdate`, `CaseStudy`, `CaseStudyCreate`, `CaseStudyUpdate`, `Exploration`, `ExplorationList`, `ExplorationCreate`, `ExplorationUpdate`, `ExplorationStatus`, `Service`, `ServiceList`, `ServiceCreate`, `ServiceUpdate`, `ServiceEvidence`, `ServiceEvidenceInput`, `ServiceEvidenceKind`, `ProjectLink`, `Health`, `ErrorResponse`, `ErrorField`, `ErrorCode` | The contract's DTOs as the OpenAPI document describes them (write bodies as accepted on input, so defaulted fields are optional).                                                                                                                                                                                                       |

The API key is sent as `Authorization: Bearer` only to operations whose OpenAPI `security` requires one, looked up per operation in the committed document; public reads never carry it. The API declares security per operation only, so a document-level `security` is not consulted; adding one to the API means extending the lookup in `src/index.ts` and the contract tests. The key is for server-side callers only and never reaches client-side code. The base address comes from the consumer's environment; nothing here knows a host or port.

## Generation

| Task                                                        | Command (from the repository root)          |
| ----------------------------------------------------------- | ------------------------------------------- |
| Export the OpenAPI document and regenerate the client types | `pnpm generate:api-client`                  |
| Check that the committed files match a regeneration (CI)    | `pnpm check:api-client`                     |
| Only regenerate the types from the committed document       | `pnpm --filter @sebela/api-client generate` |

`src/generated/openapi.json` is exported from the API's source by `openapi:export` of `@sebela/api`, with no database, configuration or secrets; `src/generated/schema.ts` is generated from it by openapi-typescript (`--default-non-nullable false`). Both are committed, never edited by hand, excluded from ESLint and Prettier and typechecked with the strict configuration. The same inputs always give byte-identical files.

**Every pull request that adds, removes or changes a route or a contract schema** runs `pnpm generate:api-client`, commits `src/generated/`, exports any new DTO from `src/index.ts` and extends the consumer contract tests in `apps/api/src/client.test.ts`. CI's drift check fails when the committed files differ from a regeneration.

### Python consumers (phase 7, not scaffolded)

The committed `src/generated/openapi.json` is the language-independent input. A Python client is generated from it, without the TypeScript toolchain, with openapi-python-client (Python 3.11 or later):

```sh
uvx openapi-python-client@0.30.0 generate \
  --path packages/api-client/src/generated/openapi.json \
  --output-path <target-folder> --overwrite
```

Pin the version so the output is reproducible, commit the generated package where phase 7 places it and extend the drift check (`scripts/checks/generated-drift.mjs`) to that folder.

## Module map

Not a backend module layout: a generated client keeps its native placement (`docs/repository-structure.md`, Backend module layout).

| File                         | Responsibility                                                                        | Tests                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/index.ts`               | `createApiClient`, bearer injection by the documented security, the public DTO types. | `apps/api/src/client.test.ts` (against the real API) |
| `src/generated/openapi.json` | The exported OpenAPI document; generation input and the security lookup at runtime.   | `apps/api/src/cli/openapi.test.ts`, drift check      |
| `src/generated/schema.ts`    | `paths` and `components` types generated by openapi-typescript.                       | typecheck, drift check                               |

## Tests

The package has no tests of its own: its behaviour is observed through the consumer contract tests in `apps/api` (`pnpm --filter @sebela/api test`, needs Postgres), and its generated files through `pnpm check:api-client`.
