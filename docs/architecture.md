# Architecture

How the system is layered and why. Parts belonging to later phases are described as planned; see `.plan/00-overview/prd.md` for the phase of each.

## Overview

```text
browser -> web -> api -> ai-service -> packages/llm-agent (chat pipeline)
external agent -> mcp-public -> ai-service (read capabilities) -> api
owner's agent -> mcp-admin -> api (authenticated content writes)
api -> packages/services -> packages/db -> PostgreSQL
                        -> packages/memory (knowledge ingest/retrieval orchestration)

Retrieval persistence is owned by packages/db in the same pgvector-enabled Postgres.

AI-service tools read public content/search through api over HTTP.
```

## The API is the trust boundary

The website, `mcp-admin` and `ai-service` reach content only through `apps/api` over HTTP. The public MCP adapter reaches AI read capabilities through `ai-service`, which reads the content API. Only the API backend accesses persistence.

This is a security decision, not a preference for HTTP. The system has write access for agents, two MCP servers with different threat models and a public chatbot. Content authorization is enforced at the API. FastAPI separately authenticates its internal generation route and applies AI runtime admission; public MCP reads cannot invoke it. Neither Python app can bypass content authorization.

The cost is extra HTTP hops and independently managed runtime processes. This is accepted for the content and AI boundaries.

## Layers

| Layer                        | Responsibility                                                  | Knows about                                                            |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Clients (`web`, `mcp-admin`) | Presentation and administration protocol                        | The content API contract                                               |
| `mcp-public`                 | Public read-only MCP transport                                  | The AI read-capability contract                                        |
| `ai-service`                 | FastAPI AI routes, lifecycle and execution admission            | `llm-agent` package and public content API                             |
| `llm-agent` package          | Three-stage pipelines, read tools, models, guardrails and evals | Generated content API models/client; no TypeScript imports or database |
| `api`                        | HTTP, authentication, validation, OpenAPI                       | `services`, `contracts`                                                |
| `services`                   | Domain logic, composition (for example assembling the CV)       | `db`, `contracts`, `memory`                                            |
| `db`                         | Schema, migrations, repositories, seed                          | PostgreSQL                                                             |
| `contracts`                  | Zod schemas and types shared by the API and its clients         | Nothing else in the repository                                         |

A controller in the API stays thin: it validates input, calls a service, returns the result. Authentication is middleware on the private route group, not logic inside handlers.

## Module responsibilities and composition

A domain may have an HTTP module in the API, an operation in services and a persistence module in db. Those are different responsibilities, not three public versions of the same implementation. HTTP adapts the request/response and applies security; services coordinate the domain use case; db performs cohesive persistence operations and owns SQL/transaction mechanics. Contracts describe transport data independently of services and db. Storage hides provider SDKs/key layout; media coordinates upload checks, metadata, attachment and cleanup.

Create resources at the backend startup/composition entry and the corresponding maintenance CLI path. Keep package dependencies unchanged: API composition calls permitted services entries, and services use db through persistence entries. Do not import db directly into API startup as a shortcut, or pass raw database/SDK handles out to HTTP/client code. Pass validated configuration and the required capabilities once; runtime modules do not repeatedly read environment variables or construct hidden clients. Close owned resources at shutdown.

For a multi-record mutation, the caller requests a complete operation. Services ask db to perform the necessary atomic persistence change; callers never manage SQL transaction primitives. File storage and database commits are not one transaction: media explicitly owns validation, ordering and compensation/cleanup on failure. Public interfaces document these guarantees and expected errors.

Module dependencies are acyclic and cross only explicit entries. [Repository structure](repository-structure.md#backend-module-layout) defines imports/placement; [code standards](code-standards.md#deep-modules) explains interface design and review. Required HTTP/security adapters remain even if they are small; deep modules do not remove the API trust boundary.

## Data

- **The API/database is authoritative for structured facts.** Approved supplemental documents add explanations and context without overriding API facts. Nothing in the repository mirrors real content or original documents.
- One database, separate Postgres schemas per domain: `profile`, `ai_roadmap`, later schemas for chat, retrieval and private ingest state. Domains are linked through shared topics and technologies.
- Content is written through the API — by agents using `mcp-admin` — and appears on the website without a redeploy. Backend maintenance CLIs (seed/key commands and phase-9 knowledge ingest) reuse services and their persistence operations in-process; these are not client/Python database-access exceptions.
- The repository ships a fictional demo seed. The owner's real data is loaded once from a private seed outside the repository; afterwards safety comes from database backups.

## Files

- Images and the CV file are kept in object storage behind one interface with two drivers: Bunny Storage through its S3-compatible API, and local disk for tests, CI and environments without keys.
- Uploads go through a private API route; nothing uploads to the bucket directly.
- The database stores a file's key; the public base address is configuration.
- Development and production use separate storage zones with separate keys.
- Logos of technologies are static assets of the website, not uploads.
- From phase 9, knowledge originals use a separate private Bunny Storage Zone/credentials without a public Pull Zone/CDN mapping, or a separate private local root outside static serving. Reuse the configured `bunny-s3`/`local` drivers, but private operations do not yield public URLs. An unavailable provider fails explicitly rather than silently switching stores.
- Public query embeddings/reranking require API-owned retrieval and overall-AI budget admission, including anonymous MCP searches; public read-only status does not make hosted search free. Exhaustion/provider failure is distinct from finding no evidence.
- Back up originals and source/version/approval metadata; embedding indexes are derived and rebuildable. Only the backend/maintenance path reads originals; neither MCP nor Python receives storage credentials.

## Access

- No user accounts and no login UI.
- The API has two groups of routes:
  - **Public** — no authentication; read-only, except that a visitor may create, continue and delete their own chat conversation (phase 7). The website and the assistant use these.
  - **Private** — protected by an API key checked in middleware. Every write is a private route.
- API keys are created with a command, shown once and stored only as a hash. Each has a name and can be revoked on its own. A key is used only by server-side callers and never reaches a browser: the website calls public routes only.
- Profile/roadmap content has no per-record private flag. Auth, audit, conversations and pending/rejected ingest records are private operational state. Only approved knowledge passage projections are exposed; raw originals and staging data are not public. See `docs/domain-context.md`.
- Admin MCP and private content-write routes are internal/SSH-tunnel only, with authentication still required. Apply this to the public API proxy too, so it cannot provide a route around MCP's network boundary. The visitor-owned conversation exception remains public.

## Website

Next.js is used as a frontend only. Pages render on the server at request time, with caching and invalidation when content changes — not at build time. The build therefore needs no running API, and a content edit needs no deploy.

From phase 3, committed API content writes notify a private website invalidation endpoint, authenticated with a dedicated server-only signing secret independent of content API keys. The website still reads only public API routes and holds no content API key. Validated content references map to affected pages, with safe duplicate delivery and bounded retries. Notification failure never undoes a committed write; time-based revalidation recovers from lost notifications. Freshness and failure criteria are defined in `.plan/03-web/prd.md` under "Cache invalidation guarantees".

## MCP servers and the AI runtime

| App/package          | Language         | Responsibility                                                                        |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `apps/mcp-admin`     | TypeScript       | Authenticated management tools -> private content API; internal/SSH-tunnel access     |
| `apps/mcp-public`    | Python           | Public read tools -> FastAPI capability routes; external agents bring their model     |
| `apps/ai-service`    | Python / FastAPI | Separate AI HTTP routes, chat generation, read capabilities and runtime lifecycle     |
| `packages/llm-agent` | Python           | Library: pipelines, shared read-tool implementations, providers, guardrails and evals |

Delivery is incremental: phase 6 builds the package and local runner; phase 7 wraps it in FastAPI and replaces the web mock using structured reads; phase 8 adds public MCP. RAG arrives in phase 9. Apps are separate deployables; the package is installed in Python app images and has no server lifecycle. Read capability implementations are shared through the package: chat invokes them internally and MCP calls them through FastAPI. The public MCP server exposes no chat tool. `mcp-admin` calls the content API directly and does not depend on the AI runtime.

`apps/api` and `apps/ai-service` have separate routes and OpenAPI contracts. Content/event schemas are generated from the content API; FastAPI validates AI-specific contracts with Pydantic. Content authentication and its hashed-key store stay in TypeScript. Internal chat generation uses a separate service credential unavailable to the model, granting no content-write authority. Public AI read routes cannot call generation or private content routes.

## Knowledge and retrieval

- Phase 9 adds RAG over the owner's portfolio API content and extra owner-supplied Markdown/TXT/text-layer PDF documents. There is no duplicate crawl of rendered pages, external-source crawl or live web search.
- `packages/memory` retains its planned TypeScript knowledge/index boundary, called only by the API backend. It does not store visitor conversation memory. SQL/persistence remain behind the backend's db operations; Python reads bounded API capabilities only.
- Chunks, vectors, sources and versions live in a separate schema in the same PostgreSQL/pgvector. Hosted embeddings, full-text/vector/hybrid search and optional reranking are selected with evals; no second vector database is required.
- Terminal ingest stages extra files privately, extracts text under limits, runs local sensitivity checks and obtains explicit owner approval of that exact version before external embedding calls or public indexing. Rejected/pending content never reaches search or an agent. Automated checking is not proof of confidentiality.
- API facts take precedence over supplemental text. Known contradictory claims are held for owner resolution; extra material explains facts and context. Approved information can be disclosed publicly even though its original file has no public download.
- Public results contain current approved passages, safe source labels and canonical site links when a page exists. Extra sources without a public page have a label/identifier, never a fabricated URL or private storage link.
- Incremental indexing follows content writes with recoverable pending state; provider failure does not undo a committed content write. Delete/withdraw superseded evidence promptly. Rebuild from current API data and retained approved originals while preserving approval state.
- After the phase-10 launch, phase 11 adds a source-backed graph using a small initial schema; phase 12 develops the ontology and evaluates NVIDIA Auto Ontology separately. Neither introduces direct Python database access or an enterprise platform by default. Phase 13 handles external MCP UI independently.

## Chat

- The browser never talks to the assistant. It talks to the website, which talks to the API.
- **The API owns the conversation:** the anonymous visitor cookie, ownership of one conversation per browser identity, rate limits, bot detection, the daily budget, and storage of every conversation.
- Direct `/ask` navigation restores that identity's conversation; no session picker or cross-device identification. Losing the cookie loses the anonymous identity, and a URL alone grants no access.
- **The assistant produces the answer:** an input guard (a small model), generation by a model with read tools and search, deterministic output checks. It is stateless; the API sends it the conversation so far.
- Model-visible tools are allowlisted public reads; provider/service credentials stay outside model context. No content-write key or write tool enters the pipeline. Injection can still corrupt answers; direct/indirect attack evals measure the residual risk.
- `packages/llm-agent` runs exactly three LangGraph stages: Security Gateway (rules + cheap classifier, allow/block/uncertain), Main Agent (bounded tools loop) and Output Guard (deterministic schema/evidence/link checks, no LLM). Generation is buffered until validation; progress events may precede approved content.
- LangChain provides configured OpenAI/Anthropic model integrations. API reservations enforce global cost ceilings; runtime limits bound each call/attempt. Cancellation, deadlines, concurrency and idempotency are explicit contracts, described in the phase-7 PRD.
- Answers carry typed blocks (contact, experience, service, exploration, roadmap, sources) that the website renders with its own components. Public MCP initially returns structured data/text; external interactive UI is phase 13.
- Phase 3 defines the validated application event/block contract in `packages/contracts` and a browser-local mock adapter. Components depend on that contract rather than transport framing. Phase 7 implements the real API transport/adapter, including idempotent request identifiers and recoverable failures. The mock introduces no live conversation API or server-side storage.
- Langfuse receives redacted traces; scoring runs off the visitor path under its own budget. Promptfoo covers component/end-to-end evals, pytest deterministic failures, and human review covers ambiguous and sampled automatically passed answers. Telemetry failure never bypasses budgets or blocks valid answers.

## Background work

There is no worker by default. One is added only for a concrete job; the first likely one is asynchronous reindexing after a change in Postgres.

## Deployment

Docker throughout: a Dockerfile per app and one Compose stack, the same composition locally and in production. The target is the owner's VPS. Production specifics are in `docs/release-workflow.md`.
