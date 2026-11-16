# @sebela/contracts

Zod schemas and types shared by the API and its clients. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A library with no runtime dependencies in this repository except `@sebela/config` for tooling (dependency table in `docs/repository-structure.md`). It knows nothing about HTTP routing, services or the database: it defines what crosses the API boundary. The API validates requests with these schemas and generates its OpenAPI document from them, so a schema change is a contract change and updates the OpenAPI expectations in `apps/api`.

## Public interface

Only the root export `@sebela/contracts` (`src/index.ts`) is public.

| Export                                                                         | What it provides                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PersonSchema`, `PersonCreateSchema`, `PersonUpdateSchema`, `PersonLinkSchema` | The person as returned (ISO timestamps, `null` for an unset optional field) and the write bodies. Write bodies are strict: unknown fields are rejected. An update needs one field. |
| `Person`, `PersonCreate`, `PersonUpdate`, `PersonLink`                         | The inferred types; the write types are the parsed outputs, with defaults applied.                                                                                                 |
| `ErrorResponseSchema`, `errorCodes`, `ErrorCode`, `ErrorResponse`              | The common error shape of every failed request and the full list of error codes, each with its fixed status (documented in `src/errors.ts`).                                       |

Schemas carry an OpenAPI component id through `.meta({ id })`; keep ids stable, because they name components in the generated document.

## Module map

| Module                | Entry                          | Responsibility and hidden decisions                                                                                                                              | Depends on | Tests                               |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------- |
| `src/modules/profile` | `src/modules/profile/index.ts` | The person contract: field limits, trimming, `http`/`https` links with a domain host, ISO date of the career start, defaults of a create and the partial update. | `zod`      | `src/modules/profile/index.test.ts` |

Files outside modules: `errors.ts` (the common error contract, shared by every module, tested in `src/errors.test.ts`) and `index.ts` (the public export).

## Tests

`pnpm --filter @sebela/contracts test`. Pure unit tests with small fictional values; no database.
