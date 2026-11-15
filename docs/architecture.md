# Architecture

How the system is layered and why. Parts belonging to later phases are described as planned; see `.plan/00-overview/prd.md` for the phase of each.

## Overview

```
            Browser                              AI agents
               |                                /         \
           apps/web                 apps/llm-agent     apps/mcp-admin
               |                     (public MCP,          |
               |                      chat pipeline)       |
               |                    /        |             |          HTTP only
               +----------------- apps/api ---------------+          public reads, authenticated writes
                                     |
                             packages/services                       domain logic
                              /              \
                      packages/db        packages/memory
                           |                  |
                      PostgreSQL        pgvector (same Postgres)

   chat: browser -> web -> api (conversation, limits, budget, storage) -> llm-agent (answer) -> api (public reads)
```

## The API is the trust boundary

Every client — the website, `mcp-admin` and `llm-agent` — reaches data only through the API over HTTP.

This is a security decision, not a preference for HTTP. The system has write access for agents, two MCP servers with different threat models and a public chatbot. Authentication is enforced once, at one boundary. No client can bypass them, because no client has another way to the data.

The cost is a network hop and a second service to run. It is accepted.

## Layers

| Layer | Responsibility | Knows about |
|---|---|---|
| Clients (`web`, `mcp-admin`, `llm-agent`) | Presentation, protocol and the AI pipeline: pages, MCP tools, answers | The API contract only |
| `api` | HTTP, authentication, validation, OpenAPI | `services`, `contracts` |
| `services` | Domain logic, composition (for example assembling the CV) | `db`, `contracts`, `memory` |
| `db` | Schema, migrations, repositories, seed | PostgreSQL |
| `contracts` | Zod schemas and types shared by the API and its clients | Nothing else in the repository |

A controller in the API stays thin: it validates input, calls a service, returns the result. Authentication is middleware on the private route group, not logic inside handlers.

## Module responsibilities and composition

A domain may have an HTTP module in the API, an operation in services and a persistence module in db. Those are different responsibilities, not three public versions of the same implementation. HTTP adapts the request/response and applies security; services coordinate the domain use case; db performs cohesive persistence operations and owns SQL/transaction mechanics. Contracts describe transport data independently of services and db. Storage hides provider SDKs/key layout; media coordinates upload checks, metadata, attachment and cleanup.

Create resources at the backend startup/composition entry and the corresponding maintenance CLI path. Keep package dependencies unchanged: API composition calls permitted services entries, and services use db through persistence entries. Do not import db directly into API startup as a shortcut, or pass raw database/SDK handles out to HTTP/client code. Pass validated configuration and the required capabilities once; runtime modules do not repeatedly read environment variables or construct hidden clients. Close owned resources at shutdown.

For a multi-record mutation, the caller requests a complete operation. Services ask db to perform the necessary atomic persistence change; callers never manage SQL transaction primitives. File storage and database commits are not one transaction: media explicitly owns validation, ordering and compensation/cleanup on failure. Public interfaces document these guarantees and expected errors.

Module dependencies are acyclic and cross only explicit entries. [Repository structure](repository-structure.md#backend-module-layout) defines imports/placement; [code standards](code-standards.md#deep-modules) explains interface design and review. Required HTTP/security adapters remain even if they are small; deep modules do not remove the API trust boundary.

## Data

- **PostgreSQL is the single canonical source.** Nothing in the repository mirrors live content.
- One database, separate Postgres schemas per domain: `profile`, `ai_roadmap`, later schemas for chat and retrieval state. Domains are linked through shared topics and technologies.
- Content is written through the API — by agents using `mcp-admin` — and appears on the website without a redeploy.
- The repository ships a fictional demo seed. The owner's real data is loaded once from a private seed outside the repository; afterwards safety comes from database backups.

## Files

- Images and the CV file are kept in object storage behind one interface with two drivers: Bunny Storage through its S3-compatible API, and local disk for tests, CI and environments without keys.
- Uploads go through a private API route; nothing uploads to the bucket directly.
- The database stores a file's key; the public base address is configuration.
- Development and production use separate storage zones with separate keys.
- Logos of technologies are static assets of the website, not uploads.

## Access

- No user accounts and no login UI.
- The API has two groups of routes:
  - **Public** — no authentication; read-only, except that a visitor may create and continue their own chat conversation (phase 7). The website and the assistant use these.
  - **Private** — protected by an API key checked in middleware. Every write is a private route.
- API keys are created with a command, shown once and stored only as a hash. Each has a name and can be revoked on its own. A key is used only by server-side callers and never reaches a browser: the website calls public routes only.
- There is no visibility model: everything in the database is public content. A private flag is introduced only when a real use case needs it. See `docs/domain-context.md`.

## Website

Next.js is used as a frontend only. Pages render on the server at request time, with caching and invalidation when content changes — not at build time. The build therefore needs no running API, and a content edit needs no deploy.

From phase 3, committed API content writes notify a private website invalidation endpoint, authenticated with a dedicated server-only signing secret independent of content API keys. The website still reads only public API routes and holds no content API key. Validated content references map to affected pages, with safe duplicate delivery and bounded retries. Notification failure never undoes a committed write; time-based revalidation recovers from lost notifications. Freshness and failure criteria are defined in `.plan/03-web/prd.md` under "Cache invalidation guarantees".

## MCP servers and the LLM agent

| App | Language | Capabilities | Callers |
|---|---|---|---|
| `mcp-admin` | TypeScript | Write, through private API routes | The owner's agents, with an API key |
| `llm-agent` | Python | Read-only, through public API routes: the public MCP server and the chat pipeline | Any AI agent (MCP); the API (chat) |

Both are API clients and both are deployed as HTTP services. They stay separate because their threat models differ: one can write, the other is public and read-only.

- `mcp-admin` reuses the shared schemas and the generated client. It stores no API key: it passes on the key its caller presents, and the API verifies it. Every write it causes is recorded.
- `llm-agent` is the whole AI layer in one Python service (FastAPI, LangGraph). Its read tools are written once and used both by the public MCP server and by the chat agent. Its client is generated from the OpenAPI document — the contract does not depend on TypeScript.

## Retrieval

- Retrieval is the project's own implementation on pgvector in the same Postgres: documents are split into chunks, embedded through a hosted embeddings API, and searched with vector similarity and full-text search combined. No separate vector database and no knowledge-graph service.
- It lives in the backend (`packages/memory`) and is exposed as a public search route. It is derived from Postgres and can be rebuilt from it at any time.

## Chat

- The browser never talks to the assistant. It talks to the website, which talks to the API.
- **The API owns the conversation:** the anonymous visitor cookie, ownership of a conversation, rate limits, bot detection, the daily budget, and storage of every conversation.
- **The assistant produces the answer:** an input guard (a small model), generation by a model with read tools and search, deterministic output checks. It is stateless; the API sends it the conversation so far.
- The assistant has no API key and no write tool. A successful prompt injection has nothing to extract and nothing to change.
- Answers carry typed blocks (contact, experience, service, exploration, roadmap, sources) that the website renders with its own components.
- Phase 3 defines the validated application event/block contract in `packages/contracts` and a browser-local mock adapter. Components depend on that contract rather than transport framing. Phase 7 implements the real API transport/adapter, including idempotent request identifiers and recoverable failures. The mock introduces no live conversation API or server-side storage.
- Everything is traced; stored conversations are scored afterwards, off the visitor's path.

## Background work

There is no worker by default. One is added only for a concrete job; the first likely one is asynchronous reindexing after a change in Postgres.

## Deployment

Docker throughout: a Dockerfile per app and one Compose stack, the same composition locally and in production. The target is the owner's VPS. Production specifics are in `docs/release-workflow.md`.
