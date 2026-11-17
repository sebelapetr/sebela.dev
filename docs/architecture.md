# Architecture

How the system is layered and why. Parts belonging to later phases are described as planned; see `.plan/00-overview/prd.md` for the phase of each.

## Overview

```text
browser -> web -> api -> ai-service -> packages/llm-agent (chat pipeline)
external agent -> mcp-public -> ai-service (read capabilities) -> api
owner's agent -> mcp-admin -> api (authenticated content writes)
api -> packages/services -> packages/db -> PostgreSQL
                        -> packages/memory -> pgvector (same Postgres)

AI-service tools read public content/search through api over HTTP.
```

## The API is the trust boundary

The website, `mcp-admin` and `ai-service` reach content only through `apps/api` over HTTP. The website's one other read, the current CV PDF's public stored file at the address the API gives, is described under Website. The public MCP adapter reaches AI read capabilities through `ai-service`, which reads the content API. Only the API backend accesses persistence.

This is a security decision, not a preference for HTTP. The system has write access for agents, two MCP servers with different threat models and a public chatbot. Content authorization is enforced at the API. FastAPI separately authenticates its internal generation route and applies AI runtime admission; public MCP reads cannot invoke it. Neither Python app can bypass content authorization.

The cost is extra HTTP hops and independently managed runtime processes. This is accepted for the content and AI boundaries.

## Layers

| Layer                        | Responsibility                                                                                              | Knows about                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Clients (`web`, `mcp-admin`) | Presentation and administration protocol                                                                    | The content API contract                                               |
| `mcp-public`                 | Public read-only MCP transport                                                                              | The AI read-capability contract                                        |
| `ai-service`                 | FastAPI AI routes, lifecycle and execution admission                                                        | `llm-agent` package and public content API                             |
| `llm-agent` package          | Three-stage pipelines, read tools, models, guardrails and evals                                             | Generated content API models/client; no TypeScript imports or database |
| `api`                        | HTTP, authentication, validation, OpenAPI                                                                   | `services`, `contracts`                                                |
| `services`                   | Domain logic, composition (for example assembling the CV)                                                   | `db`, `contracts`, `memory`                                            |
| `db`                         | Schema, migrations, repositories, seed                                                                      | PostgreSQL                                                             |
| `contracts`                  | Zod schemas and types shared by the API and its clients                                                     | Nothing else in the repository                                         |
| `api-client`                 | The typed HTTP client of the content API, generated from its OpenAPI document; server-side bearer injection | The committed OpenAPI document; nothing else in the repository         |

A controller in the API stays thin: it validates input, calls a service, returns the result. Authentication is middleware on the private route group, not logic inside handlers.

## Module responsibilities and composition

A domain may have an HTTP module in the API, an operation in services and a persistence module in db. Those are different responsibilities, not three public versions of the same implementation. HTTP adapts the request/response and applies security; services coordinate the domain use case; db performs cohesive persistence operations and owns SQL/transaction mechanics. Contracts describe transport data independently of services and db. Storage hides provider SDKs/key layout; media coordinates upload checks, metadata, attachment and cleanup.

Create resources at the backend startup/composition entry and the corresponding maintenance CLI path. Keep package dependencies unchanged: API composition calls permitted services entries, and services use db through persistence entries. Do not import db directly into API startup as a shortcut, or pass raw database/SDK handles out to HTTP/client code. Pass validated configuration and the required capabilities once; runtime modules do not repeatedly read environment variables or construct hidden clients. Close owned resources at shutdown.

For a multi-record mutation, the caller requests a complete operation. Services ask db to perform the necessary atomic persistence change; callers never manage SQL transaction primitives. One named exception: a services use case that must apply many complete operations as one (today only the seed load) runs them inside `Persistence.transaction(work)`, a caller-scoped unit of work that commits or rolls back all of them, runs their own transactions as savepoints and still hands over only persistence operations ([decision 0015](decisions/0015-caller-scoped-unit-of-work-for-the-seed.md)). File storage and database commits are not one transaction: media explicitly owns validation, ordering and compensation/cleanup on failure. Public interfaces document these guarantees and expected errors.

The phase 2 backend modules expose cohesive operations. The table states the contract each one promises; the entry of each module documents the details:

| Module                  | Operations                                                                                          | Guarantees                                                                                                                                                                                                                                                                                                                                                                            | Errors                                                                                                                                                                                                                | Hidden behind the entry                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Profile (services, db)  | Create, update and delete profile entities with their relations; assemble the CV                    | A multi-record change is applied completely or not at all; results are domain data                                                                                                                                                                                                                                                                                                    | Not found, invalid references and rule violations as documented domain errors; no partial write                                                                                                                       | Drizzle tables, query builders, transactions and connections (db); the order of persistence steps             |
| Media (services)        | Validate an upload, store it, record its metadata and attach or detach it                           | A rejected or failed upload leaves no media record and no stored file; a stored file that cannot be recorded is removed again                                                                                                                                                                                                                                                         | Unsupported, mismatched, oversized or malformed files in the common error shape                                                                                                                                       | Signature and image checks, the ordering and compensation between storage and db                              |
| Storage (services)      | Store a file, delete it, give its public address                                                    | Keys are generated by the backend and stay inside the environment and worktree prefix; the database keeps only the key, the public base address comes from configuration; a key outside the configured prefix has no address (`null`), so a record from another environment or worktree stays readable instead of failing                                                             | Driver failures become storage errors of the module, never SDK or file-system errors                                                                                                                                  | Storage key generation, the key layout and the prefixes, the `local` and `bunny-s3` drivers and the S3 client |
| Seed (services)         | Load a seed folder (the demo or an external one) through the profile and media services, in-process | Records are matched by slug (the person as singleton, a case study by its project) and overwritten; unnamed records stay; an identical rerun changes nothing; identical files are reused; every record write commits or rolls back together, files stored by a failed load are removed; media a seed record stopped using are deleted after a successful load unless still referenced | One `validation_failed` naming every problem by file and field before any write (malformed or unknown files, schema failures, bad file paths or files, unresolved references); messages never contain the folder path | Folder reading and parsing, the order of writes, matching, the unit of work and media compensation            |
| API keys (services, db) | Create a named key (shown once), list metadata, revoke one key, verify a presented key              | Only a hash is stored; verification compares in constant time; revocation applies to the next request; listing never returns a key or its hash                                                                                                                                                                                                                                        | Missing, malformed, unknown and revoked keys give one indistinguishable failure, which the API turns into the same `401`                                                                                              | Key generation, the prefix, hashing and the key schema                                                        |

SQL and driver objects do not cross these entries. A caller holding a transaction, a table or an S3 client could perform half of an operation, bypass validation or depend on one driver, and every change of persistence or provider would reach it. Callers receive domain results and documented errors instead.

Module dependencies are acyclic and cross only explicit entries. [Repository structure](repository-structure.md#backend-module-layout) defines imports/placement; [code standards](code-standards.md#deep-modules) explains interface design and review. Required HTTP/security adapters remain even if they are small; deep modules do not remove the API trust boundary.

## Data

- **PostgreSQL is the single canonical source.** Nothing in the repository mirrors live content.
- One database, separate Postgres schemas per domain: `profile`, `auth` (API keys), `ai_roadmap`, later schemas for chat and retrieval state. Migrations are applied by the db package's own command (`pnpm --filter @sebela/db db:migrate`); starting the API never migrates. Domains are linked through shared topics and technologies.
- Content is written through the API — by agents using `mcp-admin` — and appears on the website without a redeploy.
- The repository ships a fictional demo seed. The owner's real data is loaded once from a private seed outside the repository; afterwards safety comes from database backups.

## Files

- Images and the CV file are kept in object storage behind one interface with two drivers: Bunny Storage through its S3-compatible API, and local disk for tests, CI and environments without keys.
- Uploads go through a private API route; nothing uploads to the bucket directly.
- The database stores a file's key; the public base address is configuration.
- Uploads are proved by their content: PNG, JPEG, WebP and PDF only, within configured byte and image-dimension limits, checked structurally with work bounded by the file size. Pixels are deliberately never decoded: a structural walk keeps the work predictable and needs no image library, at the cost of accepting a well-formed file whose image data is corrupt. The API generates every key; a file name never chooses where a file goes.
- Files of the local driver are served by the API itself at a public route under the key, inline, with the recorded type, `nosniff` and a content security policy that loads nothing. Images are also sandboxed; a PDF is not, because browser PDF viewers refuse to render a sandboxed document, and it is offered under the file name of its key, so the current CV opens in the browser; files of the Bunny driver are served by the zone's CDN pull zone from `STORAGE_PUBLIC_BASE_URL`, never from the storage API.
- Profile records refer to media by identifier (the person's photo and current CV PDF, an organization's logo, a project's cover, a testimonial's author photo). Referenced media cannot be deleted. The current CV PDF is uploaded as prepared, not generated.
- A file the media workflow cannot remove, after a failed record write or a deleted record, is logged with its key without secrets and stays as an orphan no record refers to; it is removed by hand. A successful response never refers to a missing file.
- Development and production use separate storage zones with separate keys.

### Bunny Storage

The `bunny-s3` driver talks to a Bunny storage zone through Bunny's S3-compatible API with the maintained AWS S3 client, path-style, using only PutObject and DeleteObject. Sources, checked on 2026-11-16: [S3 compatibility](https://bunny.net/docs/storage/s3) and the [storage changelog](https://bunny.net/docs/storage/changelog).

- **Status.** S3 compatibility is a public preview (since 2026-07-09); behaviour may still change.
- **Zone.** S3 compatibility must be enabled when the zone is created; an existing zone cannot be switched. Only the regions the documentation lists have an S3 endpoint (`https://<region>-s3.storage.bunnycdn.com`); other regions answer 501.
- **Credentials.** The access key id is the zone name (also the bucket) and the secret is the zone password. They are signed into requests and never sent, logged or put into an error.
- **Limitations that shape the driver.** No ACLs, object lock, versioning, server-side encryption or lifecycle rules, and conditional writes are not documented, so a new file is not guarded against replacement by the zone; keys carry 122 random bits instead. Bunny validates `x-amz-checksum-sha256`, so every upload sends it and the SDK's default CRC32 checksum is turned off. Bunny documents `NoSuchKey` (404) but not what a single DeleteObject of a missing key answers, so the driver counts `NoSuchKey` as removed and every other failure, another 404 such as `NoSuchBucket` included, as an error. Metadata is limited to 2 KB; the driver sends none. Requests are rate-limited (500 per second).
- **Delivery.** Public files are served by a CDN pull zone attached to the storage zone; `STORAGE_PUBLIC_BASE_URL` is its https address and may not be the storage endpoint. Presigned addresses are not used. Uploads still pass through the private API.
- **Minimum configuration.** `STORAGE_DRIVER=bunny-s3`, `STORAGE_BUNNY_ENDPOINT`, `STORAGE_BUNNY_REGION`, `STORAGE_BUNNY_ZONE`, `STORAGE_BUNNY_PASSWORD`, `STORAGE_ENVIRONMENT`, `STORAGE_PUBLIC_BASE_URL` and, in `development`, `STORAGE_WORKTREE`.
- **Zones and keys per environment.** Production has its own zone and password, held only by the production deployment. Development has a separate zone that every development worktree shares; each worktree writes below `development/<worktree>/` and its driver refuses any key outside that prefix, so it cannot touch another worktree's or production's files. A development worktree never needs the production password, and the local driver needs no key at all.
- Logos of technologies are static assets of the website, not uploads.

## Access

- No user accounts and no login UI.
- The API has two groups of routes:
  - **Public** — no authentication; read-only, except that a visitor may create, continue and delete their own chat conversation (phase 7). The website and the assistant use these.
  - **Private** — protected by an API key checked in middleware. Every write is a private route.
- API keys are created with a command, shown once and stored only as a hash. Each has a name and can be revoked on its own. A key is used only by server-side callers and never reaches a browser: the website calls public routes only.
- Every request passes the same checks in order, before any handler: a per-client rate budget (health has its own), refusal of credentials in the query string, then on private routes the bearer key and a per-key budget, then on routes with path parameters their schema, then on routes with a body its content type, size and schema. Rate limits are bounded, in memory and per process; `X-Forwarded-For` counts only from configured trusted proxies. Every failure uses the common error shape of `@sebela/contracts`; CORS is not enabled. Details: `apps/api/AGENTS.md`.
- A successful write passes through one notification attachment point in the API, a no-op until a consumer exists (for example web invalidation or reindexing).
- There is no visibility model: everything in the database is public content. A private flag is introduced only when a real use case needs it. See `docs/domain-context.md`.

## Website

Next.js is used as a frontend only. Pages render on the server at request time, with caching and invalidation when content changes — not at build time. The build therefore needs no running API, and a content edit needs no deploy.

The website reads content from the API's public routes only. One read leaves the API: for the CV PDF download (`/cv/pdf`) the website's server fetches the current PDF's stored file from the public `url` the API's media gives, which is the API's own file route with local storage and the storage's CDN pull zone (`STORAGE_PUBLIC_BASE_URL`) in production. It fetches only an https address or plain http on the API's own origin, follows no redirect, sends no credentials and passes the file on only when it arrives whole as a PDF. This is a public file anyone can fetch, not a way around the API's access rules: which file is current is still decided by the API.

From phase 3, committed API content writes notify a private website invalidation endpoint, authenticated with a dedicated server-only signing secret independent of content API keys. The website still reads only public API routes and holds no content API key. Validated content references map to affected pages, with safe duplicate delivery and bounded retries. Notification failure never undoes a committed write; time-based revalidation recovers from lost notifications. Freshness and failure criteria are defined in `.plan/03-web/prd.md` under "Cache invalidation guarantees".

## MCP servers and the AI runtime

| App/package          | Language         | Responsibility                                                                        |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `apps/mcp-admin`     | TypeScript       | Authenticated management tools -> private content API; forwards caller key            |
| `apps/mcp-public`    | Python           | Public read tools -> FastAPI capability routes; external agents bring their model     |
| `apps/ai-service`    | Python / FastAPI | Separate AI HTTP routes, chat generation, read capabilities and runtime lifecycle     |
| `packages/llm-agent` | Python           | Library: pipelines, shared read-tool implementations, providers, guardrails and evals |

Apps are separate deployables; the package is installed in Python app images and has no server lifecycle. Read capability implementations are shared through the package: chat invokes them internally and MCP calls them through FastAPI. The public MCP server exposes no chat tool. `mcp-admin` calls the content API directly and does not depend on the AI runtime.

`apps/api` and `apps/ai-service` have separate routes and OpenAPI contracts. Content/event schemas are generated from the content API; FastAPI validates AI-specific contracts with Pydantic. Content authentication and its hashed-key store stay in TypeScript. Internal chat generation uses a separate service credential unavailable to the model, granting no content-write authority. Public AI read routes cannot call generation or private content routes.

## Retrieval

- Retrieval is the project's own implementation on pgvector in the same Postgres: documents are split into chunks, embedded through a hosted embeddings API, and searched with vector similarity and full-text search combined. No separate vector database and no knowledge-graph service.
- It lives in the backend (`packages/memory`) and is exposed as a public search route. It is derived from Postgres and can be rebuilt from it at any time.

## Chat

- The browser never talks to the assistant. It talks to the website, which talks to the API.
- **The API owns the conversation:** the anonymous visitor cookie, ownership of a conversation, rate limits, bot detection, the daily budget, and storage of every conversation.
- **The assistant produces the answer:** an input guard (a small model), generation by a model with read tools and search, deterministic output checks. It is stateless; the API sends it the conversation so far.
- Model-visible tools are allowlisted public reads; provider/service credentials stay outside model context. No content-write key or write tool enters the pipeline. Injection can still corrupt answers; direct/indirect attack evals measure the residual risk.
- `packages/llm-agent` runs exactly three LangGraph stages: Security Gateway (rules + cheap classifier, allow/block/uncertain), Main Agent (bounded tools loop) and Output Guard (deterministic schema/evidence/link checks, no LLM). Generation is buffered until validation; progress events may precede approved content.
- LangChain provides configured OpenAI/Anthropic model integrations. API reservations enforce global cost ceilings; runtime limits bound each call/attempt. Cancellation, deadlines, concurrency and idempotency are explicit contracts, described in the phase-7 PRD.
- Answers carry typed blocks (contact, experience, service, exploration, roadmap, sources) that the website renders with its own components.
- Phase 3 defines the validated application event/block contract in `packages/contracts` and a browser-local mock adapter. Components depend on that contract rather than transport framing. Phase 7 implements the real API transport/adapter, including idempotent request identifiers and recoverable failures. The mock introduces no live conversation API or server-side storage.
- On the website (`apps/web`, module `chat`) the seam is `ChatAdapter`: `send(submission, signal)` yields an attempt's raw events in order and stops when the signal aborts. The conversation validates every event against the contract and enforces its order, so a broken transport fails one answer, never the page; a stream that ends without a terminal event is interrupted. One answer is open at a time, a question handed from the hero is taken exactly once, and the conversation's address (`/ask?c=<random id>`) carries no question and authorises nothing. In phase 3 conversations live in the tab (`sessionStorage`); phase 7 swaps in the API's adapter and server-side storage without changing the components.
- Langfuse receives redacted traces; scoring runs off the visitor path under its own budget. Promptfoo covers component/end-to-end evals, pytest deterministic failures, and human review covers ambiguous and sampled automatically passed answers. Telemetry failure never bypasses budgets or blocks valid answers.

## Background work

There is no worker by default. One is added only for a concrete job; the first likely one is asynchronous reindexing after a change in Postgres.

## Deployment

Docker throughout: a Dockerfile per app and one Compose stack, the same composition locally and in production. The target is the owner's VPS. Production specifics are in `docs/release-workflow.md`.

Locally the API already runs this way (profile `api` of `compose.yaml`, `apps/api/AGENTS.md`, "Container stack"): a one-off migration service runs before the API, which never migrates itself, and the seed and API keys are explicit commands, so a start or restart never changes content. The image carries code and the fictional demo seed only; the owner's content stays outside the repository and the image and is loaded at run time. No production Compose file, reverse proxy, TLS or deployment exists yet.
