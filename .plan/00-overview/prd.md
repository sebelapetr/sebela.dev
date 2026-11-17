# sebelapetr.cz — Overview PRD

|        |                                                                                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Draft revision; architecture decisions confirmed, revised documents awaiting owner review                                                                                                                |
| Date   | 2026-11-17                                                                                                                                                                                               |
| Owner  | Petr Šebela                                                                                                                                                                                              |
| Scope  | Overview of the whole project. Each phase gets its own PRD in `.plan/NN-<phase>/prd.md`; those PRDs hold the detail (exact schema, endpoints, pages, tools) and must stay consistent with this document. |

## Problem Statement

Petr's current site, sebelapetr.cz, presents him as a "Web developer | Programmer" working mainly with PHP and Nette. Its content ends in 2024. It no longer matches what he does (Laravel, TypeScript, AI systems) or what he wants to be hired for.

He needs one professional site that works for two kinds of visitors at once:

- **Clients** (small and medium companies, software teams) who need to see what they can buy from him.
- **Employers** (recruiters, hiring managers, technical evaluators) who need to see his experience, how he works and where he is heading.

Separately, his learning roadmap lives in another application (Road to AI, `road-to-matrix`) on another domain, with a backend that grew through several rewrites. His CV is a separately maintained document. The same facts about him exist in several places and drift apart.

## Solution

A new sebelapetr.cz: a hybrid personal professional site built on one structured data model.

- One identity, two paths. Positioning: _software engineer focused on AI systems, automation and modern software — available for selected projects and career opportunities._
- The site answers, in this order: who he is, what he can do, what he has built, what he is doing now, where he is heading, how to work with him.
- Every fact is stored once in PostgreSQL and reused by the website, the CV, the AI Roadmap, the chatbot and the MCP servers.
- The learning roadmap moves into the site as the **AI Engineering Roadmap** — "AI Roadmap" for short. These two are the only names used; "AI Engineering Path" and "Road to AI" are retired.
- Visitors and AI agents can ask about Petr: a chatbot on the homepage and a public MCP server, both answering only from his public data.
- The repository is open source and is itself part of the portfolio: it shows how he engineers and how he works with coding agents.

The site launches publicly after phase 10 and replaces the current sebelapetr.cz. Phases 11–13 are separate post-launch improvements: knowledge graph, ontology and interactive UI for external MCP clients. They do not delay the first release.

## Audiences

| Audience                   | What they need within 30 seconds                                | Primary path                                 |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Client                     | Whether Petr can solve their problem and what exactly he offers | Homepage → Services → Contact                |
| Recruiter / hiring manager | Seniority, stack, recent work, CV                               | Homepage → Experience → CV                   |
| Technical evaluator        | Depth: how he builds, tests and reasons                         | Experience and its case studies → repository |
| AI agent                   | Structured, trustworthy facts about Petr                        | Public MCP server, `llms.txt`                |

## User Stories

### Client

1. As a client, I want to understand in the hero who Petr is and what he does, so that I can decide quickly whether to keep reading.
2. As a client, I want a clear "Work with me" path from the homepage, so that I do not have to infer services from a CV.
3. As a client, I want a list of concrete services with what I get from each, so that I know what I can order.
4. As a client, I want each service linked to real work that proves it, so that I can trust the claim.
5. As a client, I want an honest statement of what is long-standing practice and what is a newer focus, so that I can judge the risk.
6. As a client, I want to see selected work as problem → his role → result, with technologies, so that I can map them to my own situation.
7. As a client, I want obvious contact options (email, LinkedIn), so that I can reach him without a form.
8. As a client, I want to ask the chatbot what Petr offers, so that I get an answer tailored to my question.
9. As a client, I want the site to work well on my phone, so that I can read it wherever I am.

### Recruiter / hiring manager

10. As a recruiter, I want a "View my experience" path from the homepage, so that I reach the career view in one click.
11. As a recruiter, I want a timeline with companies, roles, dates, responsibilities and technologies, so that I can assess fit.
12. As a recruiter, I want a short experience snapshot on the homepage, so that I see seniority without opening another page.
13. As a recruiter, I want a print-friendly CV page and a PDF download, so that I can forward it internally.
14. As a recruiter, I want the CV page to come from the same data as the website and the PDF to show when it was last updated, so that I do not see contradictory information without knowing which is newer.
15. As a recruiter, I want technologies grouped by importance (core, AI engineering focus, other), so that I see what he is strong in rather than a flat list of 50 tools.
16. As a recruiter, I want to ask the chatbot whether Petr would fit an AI engineering role, so that I get a grounded summary.
17. As a hiring manager, I want to see what he is working on now, so that I know his current direction.
18. As a hiring manager, I want to see his AI Roadmap and learning activity, so that I can judge how serious the move into AI engineering is.

### Technical evaluator

19. As a technical evaluator, I want a case study of his main product work with an honest description of his role, so that I can ask informed questions in an interview.
20. As a technical evaluator, I want a short "independent R&D" section naming the concepts he has built or tested, so that I see initiative beyond the day job.
21. As a technical evaluator, I want built, tested and merely designed work clearly separated, so that nothing is overstated.
22. As a technical evaluator, I want a link from the site to the repository and its architecture docs, so that I can read how the site is built.
23. As a technical evaluator, I want a readable git history, PRs with reviews and passing CI, so that I can assess engineering discipline.
24. As a technical evaluator, I want the README to explain the architecture, the assistant, the MCP servers and the agent workflow, so that I understand the system without reading all the code.

### Visitor to the AI Roadmap

25. As a visitor, I want to browse the roadmap as areas, modules and resources with progress, so that I see what Petr studies and how far he is.
26. As a visitor, I want to read the public learning diary with time spent, so that I see consistent effort.
27. As a visitor, I want a bookshelf and a record of lectures, conferences and workshops, so that I see the sources behind the learning.
28. As a visitor, I want the roadmap connected to projects and technologies on the rest of the site, so that I see how learning turns into work.

### Chatbot user

29. As a visitor, I want a chat on the homepage with suggested prompts, so that I can start without thinking of a question.
30. As a visitor, I want a full-page chat at `/ask`, so that I can have a longer conversation.
31. As a visitor, I want exact questions (where did he work in 2022) answered from exact data, so that facts are correct.
32. As a visitor, I want conceptual questions (how does his backend experience connect to AI work) answered from related content, so that the answer is more than a list.
33. As a visitor, I want the chatbot to say when it does not know, so that I am not misled.
34. As a visitor, I want the chatbot to answer only from what the site itself publishes, so that I can trust it is consistent with the pages.

### AI agent consumer

35. As an AI agent, I want a public MCP server with tools for profile, experience, projects, services and the AI Roadmap, so that I can answer questions about Petr from structured data.
36. As an AI agent, I want a search tool over his public knowledge, so that I can answer open questions.
37. As an AI agent, I want the public MCP server to be read-only and limited to public data, so that I can be given access without risk.

### Petr as owner

38. As the owner, I want every fact stored once, so that one change updates the website, the CV, the chatbot and the MCP servers.
39. As the owner, I want to add and edit content by talking to an agent, so that I do not need an admin UI.
40. As the owner, I want a secured MCP server for content management, so that only my agents can write.
41. As the owner, I want every write to require an API key that only my server-side tools hold, so that nobody else can change my content.
42. As the owner, I want my existing roadmap, diary and book data imported, so that I do not lose history.
43. As the owner, I want content changes to appear on the site without a redeploy, so that updating is cheap.
44. As the owner, I want to load my real data once from a private seed kept outside the repository, so that the first environment starts with my content and the database is the only place it lives afterwards.
45. As the owner, I want backups of the database, so that content that exists nowhere else is safe.
46. As the owner, I want a whole phase to be processed unattended and to review it as one pull request, so that nothing reaches the main branch without my review and I am not needed between issues.
47. As the owner, I want the whole stack to start with one Docker Compose command, so that local and production environments are the same.

### Development agents and contributors

48. As a development agent, I want an `AGENTS.md` with the rules of the repository, so that I work the way the project expects.
49. As a development agent, I want issues that are thin vertical slices with acceptance criteria, so that I can finish one independently in a worktree.
50. As a development agent, I want a demo seed with a fictional person of realistic shape and volume, so that I can build and screenshot pages without any of Petr's data.
51. As a development agent, I want package boundaries enforced by lint, so that I cannot take a shortcut around the API.
52. As a reviewer agent, I want tests written first wherever correctness matters and visual evidence wherever appearance matters, so that I can check behaviour rather than read intent.
53. As someone forking the repository, I want a demo seed I can copy and fill with my own data, so that I get my own site without touching the code.
54. As someone forking the repository, I want a clear licence split between code and content, so that I know what I may reuse.

## Phases

Folder names below are the `.plan/` folders. Each phase has its own PRD — all of them are written before implementation starts — and gets its own set of GitHub issues when its turn comes.

Order of work: planning and the harness on `phase/00-overview` → the trial → fixes from the trial → phase 0 is merged into the main branch → phases 1–10 to the first public release, then phases 11–13 as separate improvements. Each phase is processed by the loop and merged by the owner.

| #   | Folder               | Phase                                | Result                                                                                          |
| --- | -------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 0   | `00-overview`        | Overview and harness                 | Planning, binding docs and the unattended development harness                                   |
| 0   | `00-trial`           | Trial                                | Disposable harness verification, closed without merging                                         |
| 1   | `01-foundation`      | Foundation                           | Workspace, tooling, checks, Compose/Postgres and CI                                             |
| 2   | `02-api-db`          | API and database                     | Profile domain, authenticated writes, generated contracts and demo seed                         |
| 3   | `03-web`             | Website                              | Presentation pages and chat UI behind a mock adapter                                            |
| 4   | `04-ai-roadmap`      | AI Roadmap                           | Learning domain, API, pages and the one-time launch import contract                             |
| 5   | `05-mcp-admin`       | Complete content administration      | TypeScript MCP over the private API, internal/SSH-tunnel access, skills and security gates      |
| 6   | `06-llm-agent`       | Reusable LLM agent                   | Three-stage Python package and structured API tools, tested without an HTTP server              |
| 7   | `07-ai-service`      | AI service and real web chat         | FastAPI, conversation/identity/spend controls and live chat over structured API data            |
| 8   | `08-mcp-public`      | Public MCP                           | Python read-only adapter, structured/text results and `/mcp` setup page                         |
| 9   | `09-rag`             | RAG                                  | Portfolio + approved extra documents, private originals, embeddings, retrieval and search tools |
| 10  | `10-delivery`        | Continuous delivery and first launch | Verified deployment, backups/restore, private admin networking and public release               |
| 11  | `11-knowledge-graph` | Knowledge graph                      | Evidence-backed entities/relations and measured graph-assisted retrieval after launch           |
| 12  | `12-ontology`        | Ontology                             | Reviewed semantic definitions and a bounded Auto Ontology suitability experiment                |
| 13  | `13-mcp-apps`        | External MCP UI                      | Optional interactive views in verified clients, with structured/text fallback                   |

### Phase boundaries

**0 — Overview and harness.** Planning, the documentation, the agent rules and definitions, and the harness: the phase loop, worktree isolation, hooks, permissions, GitHub labels and branch rules, minimal CI. Built by hand, because the loop cannot build itself.

**0 — Trial.** The loop processes a handful of practice issues that exercise every path through it: a dependency, a reviewer rejection, an impossible issue, a HITL issue, a forbidden action. The phase pull request is inspected and closed without merging. The harness is not considered done until this passes.

**1 — Foundation.** The first phase processed by the loop. Monorepo, shared configuration, the import-boundary and no-hard-coded-endpoint checks, a Compose file with Postgres, per-worktree databases, the full CI pipeline, the hooks that need the toolchain, README with the licence split. Not included: any app or package with behaviour.

**2 — API and database.** The `profile` domain end to end on the backend: schema, migrations, repositories, services, HTTP API with an OpenAPI description, public read routes and private routes protected by an API key, the demo seed, test fixtures. Write endpoints exist from the start because phase 5 depends on them. Not included: any UI, the AI Roadmap domain.

**3 — Website.** Next.js frontend consuming the API: homepage, Experience (career timeline with projects and inline case studies, independent R&D, technologies, education), Services, the CV page, `/ask`. The chat is a real UI — conversation flow, streaming, sources, rich blocks — fed by prepared answers behind the same interface the real backend later implements. Design system and responsive behaviour are settled here. Not included: real LLM calls, AI Roadmap pages, generating the CV PDF.

**4 — AI Roadmap.** Everything the current Road to AI application shows — roadmap, learning diary with statistics, bookshelf, FAQ, glossary, followed sources, project ideas, reading guide — carried over one to one in look and behaviour, under `/ai-roadmap` with its own sub-navigation, on a newly designed `ai_roadmap` schema. One addition: Events (attended conferences, meetups, workshops, lectures), including multi-day events, with their time counted in the diary and statistics. Phase 4 specifies the inherited progress rules, corrects diary days and statistics to Europe/Prague, and extends website invalidation. The existing data is converted once at launch by a mapper kept outside the repository, with counts, relationships and elapsed-time totals checked; the owner keeps using the old application until then. The homepage's Exploring column switches to live roadmap data.

**5 — MCP for content management.** Complete TypeScript content administration through the API. A small fixed registry supports task tools and general entity operations, not arbitrary SQL/HTTP. Admin MCP and private content writes are internal or reached through an authenticated SSH tunnel; authentication still applies. API-owned audit and deterministic security gates precede acceptance. No AI-service dependency or knowledge ingest yet.

**6 — Reusable LLM agent.** `packages/llm-agent`, a Python library with responsibility folders and exactly three stages: Security Gateway (cheap classifier), Main Agent (bounded tool loop) and Output Guard (no LLM). Structured API read tools and component/full-pipeline evals work through a runner before any server is built. Context, token/call/cost limits and cancellation are part of the package contract from the start.

**7 — AI service and real web chat.** FastAPI wraps the package; the API owns one conversation per anonymous browser identity, ownership, durable idempotency, limits and spend reservations. Replace the website mock and restore the same conversation on direct `/ask` visits. The chatbot is useful over structured data before RAG. No public MCP or retrieval prerequisite.

**8 — Public MCP.** A separate Python adapter calls FastAPI read capabilities backed by the same tools. External agents bring their model: no generation, admin or raw-file tool. Add `/mcp` with verified remote setup examples and discovery links. Return structured results and text, without interactive UI.

**9 — RAG.** Ingest -> extraction/chunking -> approval -> embeddings/index -> retrieval -> chat/MCP integration. Read the portfolio's API source rather than crawling duplicate pages. Extra Markdown/TXT/text-PDF documents enter through a terminal, local sensitivity checks and owner approval of the exact version. Their approved information may be disclosed publicly, but originals remain in private Bunny/local storage. API facts take precedence over extra explanations. Keep vectors/chunks/provenance in a separate schema of the same pgvector-enabled PostgreSQL; measure retrieval before launch. Paid public query embeddings/reranking use API-owned retrieval and overall-AI budget admission, including anonymous MCP calls.

**10 — Continuous delivery and first launch.** Build and verify the complete first-release stack, deploy to the VPS with backups/restore and rollback, load real profile data and the fresh roadmap import, approve extra sources and rebuild search. Only public web/read/chat/MCP surfaces are exposed. Graph, ontology and MCP Apps do not block this release.

**11 — Knowledge graph.** After launch, add concrete source-backed entities/relationships and bounded relationship reads. Start with a small explicit schema; measure against launched RAG and preserve source withdrawal and API authority.

**12 — Ontology.** Version/review concept meanings, relation constraints and mappings. Evaluate NVIDIA Auto Ontology on a bounded fictional export/snapshot before selecting an integration; its current relational-metadata focus is not assumed to solve unstructured-document ingest. No automatic approval of a full enterprise stack or Python database access.

**13 — External MCP UI.** Separate post-launch MCP Apps compatibility/security work over existing reads. Website cards are already delivered in phase 7; public MCP retains structured/text fallback. This phase depends on 8 and 10, not on graph or ontology, and can be scheduled independently.

## Implementation Decisions

### Architecture

```text
browser -> web -> api -> ai-service -> packages/llm-agent (chat pipeline)
external agent -> mcp-public -> ai-service (read capabilities) -> api
owner's agent -> mcp-admin -> api (authenticated content writes)
api -> packages/services -> packages/db -> PostgreSQL
                        -> packages/memory (knowledge/retrieval orchestration)

Retrieval persistence is owned by packages/db in the same pgvector-enabled Postgres.

AI-service tools read public content/search through api over HTTP.
```

- The API is the only gateway to data. The website, `mcp-admin` and `ai-service` use the content API over HTTP; `mcp-public` uses FastAPI read capabilities.
- The reason is security, not tidiness: the API is the trust boundary. The system has two MCP servers, write access for agents and a public chatbot. Content authentication is enforced at that boundary; internal AI generation has separate service authentication and admission. This supersedes the earlier idea of MCP calling shared services directly.
- Only `apps/api` (and a future worker) may import `packages/db` and `packages/services`. A lint rule enforces this.
- The API/database is authoritative for structured facts; approved extra documents provide context. Retrieval is derived and rebuildable from current API data and retained approved originals, preserving approval state.

### Monorepo

- Turborepo with pnpm workspaces on the current Node LTS. TypeScript throughout, except `apps/ai-service`, `apps/mcp-public` and `packages/llm-agent`, which use their own Python toolchain and take part in the same task pipeline and CI.
- Apps: `web` (Next.js), `api` (Hono, content/web/conversations), `mcp-admin` (TypeScript, private API tools), `mcp-public` (Python, public MCP) and `ai-service` (Python/FastAPI, AI routes/runtime). The MCP apps are separate deployables with different trust models.
- No `worker` by default. It is added only for a concrete background job; the first likely one is phase 9 (incremental reindexing); no worker is required without measured need.
- Packages: `db` (Drizzle schema, migrations, repositories, seed), `services` (domain logic, storage), `contracts` (Zod schemas and types shared by API, web and MCP), `api-client` (typed client generated from the OpenAPI document), `ui` (shared React components and design tokens), `config` (shared lint and TypeScript configuration); later `memory` (knowledge ingest and retrieval) and `llm-agent` (Python pipelines, tools, guardrails, models and evals).
- `packages/memory` is the knowledge/retrieval layer, not chat-history storage: ingest, chunking, embeddings and measured search on pgvector. Only the API backend calls it; database persistence stays behind backend operations. Graph and ontology extend this boundary later without creating another agent platform.

### Repository structure

The maintained reference is `docs/repository-structure.md`; it holds the full tree, the dependency table and the port scheme. In short:

```
apps/        web [3], api [2], mcp-admin [5], mcp-public [8], ai-service [7]
packages/    config [1], db [2], services [2], contracts [2], api-client [2], ui [3], memory [9], llm-agent [6]
scripts/     worktree setup and cleanup, the phase loop, database helpers
docs/        architecture, design, workflow, decisions
.plan/       PRDs and issue overviews per phase
.claude/     skills, rules, agents, settings (hooks and permissions)
compose.yaml in the root; a Dockerfile inside each app
```

- Package scope is `@sebela/*`.
- The demo seed lives inside `packages/db`; the owner's private seed has the same format and is loaded from outside the repository by the same command.
- End-to-end tests live in `apps/web/e2e`, evals in `apps/mcp-admin/evals`, `packages/llm-agent/evals` and `packages/memory/evals`; Python has package-local unit/integration test folders. Other tests sit next to the code.

### Parallel work in worktrees

- Agents work in parallel, each in its own git worktree, sharing one Postgres container.
- A setup script gives each worktree a slot: its own database (named after the branch, migrated and seeded with the demo seed) and its own ports for the website, the API, `mcp-admin`, `ai-service` and `mcp-public`, and in development its own folder in object storage, written to that worktree's `.env.local`. A cleanup script drops the database and frees the slot.
- Tests use a separate temporary database.
- No port, host or database name is hard-coded anywhere; everything comes from the environment, and CI checks it.

### Backend

- **Framework:** Hono. Built-in bearer authentication, CORS, security headers and streaming; OpenAPI generated from the same Zod definitions used for validation. Rate limiting through a separate middleware library; in-memory storage is enough until the chatbot phase.
- **ORM:** Drizzle. Schema in TypeScript, SQL migrations generated and committed, Zod schemas derived from tables.
- **Migrations:** applied by a dedicated one-off step before the API starts, never by the API on startup. No down migrations: fix forward, back up before deploy.
- **Database layout:** one Postgres database with separate schemas per domain — `profile` (person, organizations, experiences, projects and case studies, explorations, services, technologies, topics, education, testimonials, current focus, media), `ai_roadmap` (areas, modules, resources, diary and time entries, books, events, project ideas, followed sources, glossary), and separate schemas for API keys, the record of writes, retrieval and chat conversations. Domains are linked through shared topics and technologies.
- **API style:** REST. The OpenAPI document is generated automatically from the same Zod schemas the API validates with, and it is the contract for every client. Typed clients are generated from it — in TypeScript for the website and `mcp-admin`, and in Python for `packages/llm-agent`. FastAPI publishes its own AI contract with Pydantic validation. CI checks that the generated client is up to date.

### Files

- Images and the CV file live in object storage behind one interface: Bunny Storage through its S3-compatible API in development and production, local disk for tests, CI and environments without keys. One environment variable selects the driver.
- Development and production use separate storage zones with separate keys; development adds a folder per worktree.
- Uploads go through a private API route. The database stores the file's key; the public base address is configuration.
- Logos of technologies are static assets of the website.

- Phase-9 knowledge originals use a separate private Bunny Storage Zone without a public CDN mapping, or a private local root through the existing drivers. Retain/back up originals and source/version/approval metadata. Driver selection is explicit; storage failure never silently changes location.

### Access

- No user accounts and no login UI.
- The API has public and private route groups. Private content writes are internal/SSH-tunnel only. **Public** routes need no authentication and are read-only — with one named exception from phase 7: a visitor may create, continue and delete their own chat conversation. The website and AI read tools use them. **Private** routes are protected by an API key checked in middleware; every write is a private route.
- API keys are created with a command, shown once and stored only as a hash. Each has a name and can be revoked on its own; keys do not expire by themselves. A key is used by server-side callers only and never reaches a browser.
- Profile and roadmap records remain public content without per-record visibility flags; API keys carry no scopes. Authentication, audit, conversations and knowledge-ingest state are separate private operational data. Only approved knowledge passage projections are public; originals and pending/rejected imports are not. Admin access and private content-write routes are internal/SSH-tunnel only, with authentication still required.
- Built / tested / designed status is a data field on explorations — a fact about the record, not an access rule — so that neither the site nor the chatbot overstates it.

### Content

- The API/database is authoritative for structured portfolio facts. Approved supplemental documents add explanations and context without overriding those facts; their originals live in private storage. Nothing in the repository mirrors real content or original documents.
- The repository contains none of Petr's data. It ships a **demo seed**: a fictional person with the same shape and volume of data, used by development agents, tests, CI and anyone who clones the repository.
- Petr's real data is loaded once from a private seed kept locally, outside the repository. That seed is a bootstrap only and is not maintained afterwards; from then on content changes go through the API and safety comes from database backups.
- Tests use small fictional fixtures, so content edits never break them.
- No admin UI. Content is managed by agents through the content-management MCP server and skills.
- Language: English only. The schema must not make a later second language a rewrite.

### Website

- Next.js as a pure frontend. Pages render on the server at request time with caching and invalidation when content changes, not at build time, so the build does not need a running API and content edits need no redeploy.
- Site map (detail in the phase 3 PRD): `/` (hero with photo, headline, two paths and the chat line → what I do → selected work → experience snapshot → now → services → contact), `/experience` (career timeline with projects and inline case studies), `/services`, `/cv`, `/ask`, and from phase 4 `/ai-roadmap` with its sub-pages. There is no separate projects listing and no contact page; "Contact" in the navigation leads to the contact block on the homepage.
- Technologies have no page of their own. Core ones are shown with logos, the AI engineering focus as text, and the rest in a collapsed "other" list.
- Contact is email and links, no form.
- The chat starts from an input line in the hero and continues on `/ask`. One conversation belongs to an anonymous browser cookie and is restored on direct `/ask` navigation, without a session picker. Its random URL identifier is not authorization; someone else with the link cannot see it. There is no cross-device identity or restoration after losing the cookie.
- CV: a print-friendly `/cv` page generated from the same data. The PDF is not generated: the owner prepares it by hand, uploads it to object storage and updates it when the data changes, because a CV needs manual control over page breaks and fit.
- Side work is one "independent R&D" block, not separate project pages and not part of the CV timeline.
- SEO, structured data and `llms.txt` carry over as requirements from Road to AI.
- Analytics: Umami Cloud, cookieless, no consent banner.
- A content change invalidates the website's cache through a call from the API, so it appears within seconds without a deploy.

### Design

- Same visual language as Road to AI: black and white with neutral greys, Geist, light and dark mode, Tailwind v4 and shadcn/ui in the `base-nova` style on Base UI.
- Tokens: only the light and dark sets. The violet accent and the extra palettes from the old stylesheet are dropped. Colour is reserved for status (success, warning, destructive).
- Direction: premium technical, editorial, engineering-lab. Strong typography, whitespace, content before decoration.
- Avoid: gradients, walls of rounded cards, a waving-hand greeting, a generic SaaS landing page, a hacker-terminal look, a huge technology list.
- Mobile-first from the first component. Every UI issue is verified with screenshots at 360, 768 and 1280 px in both themes.
- A written design document in `docs/` is the reference for agents; visual review through browser screenshots is part of the loop.

### AI features

- The chatbot is a feature of the website, not a separate product. The UI is in `apps/web`; the conversation (visitor cookie, ownership, limits, budget, storage) is owned by `apps/api`; the answer is produced by `apps/ai-service` using `packages/llm-agent`.
- The pipeline of one question: limits and bot detection → an input guard (a small model: injection, off-topic, abuse) → generation by a model with read tools and search → deterministic output checks (structure, sources, links) → buffered, validated answer delivery (progress can stream earlier). Stored conversations are scored afterwards, off the visitor's path.
- No separate router: the generating model chooses between exact lookups and semantic search by calling tools.
- The model has only public read tools and no content-write credential. Provider/service credentials remain outside model context. This bounds capabilities; adversarial evals still measure answer manipulation.
- Answers carry typed blocks — contact, experience, service, exploration, roadmap, sources — rendered by the website's own components. Public MCP initially returns structured data/text. Interactive external-client UI is a separate post-launch phase 13.
- Conversations are kept without a time limit, for analysis. The visitor's address is not stored with them.
- Models come from Anthropic or OpenAI, chosen for the package in phase 6 and confirmed by evals. The API atomically reserves and reconciles spend against daily/monthly ceilings; runtime limits cover every call, retry and fallback. Provider limits add protection where available.
- **Evals:** Promptfoo for component and end-to-end behaviour; pytest for deterministic Python contracts and failures. Code/model graders are supplemented by human review of ambiguous and sampled successful cases. **Monitoring:** redacted Langfuse traces, usage, costs and offline scores.
- Two MCP deployables: TypeScript `mcp-admin` forwards caller keys to private content API routes; Python `mcp-public` calls public read capability routes on FastAPI and never runs the chat pipeline. External MCP agents bring their own model.
- FastAPI is a separate AI runtime with internal authenticated generation and public bounded read capabilities. `packages/llm-agent` owns shared tools, three-stage LangGraph pipelines, LangChain OpenAI/Anthropic integrations, guardrails, context/cost controls and evals. Python never accesses Postgres directly.
- Start with bounded single-process concurrency, cancellation/deadlines and durable idempotency in the API. No new worker, distributed AI platform or standalone provider proxy. Package contracts and evals are in phase 6; HTTP, conversation, durable spend and failure contracts are in phase 7.

### Deployment

- Docker everywhere: a Dockerfile per app and one Compose stack (website, API, Postgres with pgvector, later `mcp-admin`, `mcp-public` and `ai-service`). Local and production use the same composition.
- Target: Petr's own VPS.
- Reverse proxy, TLS, production Compose overrides, backups, deployment pipelines and the domain switch belong to phase 10, not phase 1.
- Releases are version tags on the main branch; there is no staging environment. A release is verified as a complete running stack in the pipeline before it is deployed, and a failed deployment rolls back.

### Licence

- Source code: MIT.
- Personal content, photographs, CV data, project descriptions and branding: © Petr Šebela, not covered by MIT. The README states this explicitly. The demo seed is fictional and is covered by MIT like the code.

## Testing Decisions

- **Strict test-first where correctness matters:** security, API contracts, services and domain logic, bug fixes. Tests are written first and must fail without the implementation; the reviewer agent checks this.
- **Evidence-first where appearance matters:** layout, typography and responsive polish are accepted on written acceptance criteria, Playwright checks and screenshots, and a visual review. A test written before the markup is not required there. The project exists to ship a good product, not to demonstrate a methodology.
- **Good tests check external behaviour**, not implementation: an HTTP request and its response, a rendered page, a tool call and its result.
- **Unit and integration:** Vitest for TypeScript; pytest for the Python apps/package. API tests run against a real Postgres, not mocks of the database.
- **Authentication is tested as a property:** one test walks every route and asserts that each write and each private route rejects a request without a valid API key.
- **End to end and visual:** Playwright, including screenshots at the three widths in both themes.
- **Evals-driven development for MCP and AI features:** evals are written before the implementation, with promptfoo. Safety suites must pass completely; the others have a threshold set from the first baseline and never lowered. They cover desired and forbidden behaviour: tool selection, factual grounding, saying "I don't know", prompt injection, unsupported claims, source correctness. They call real models, so they run on demand and for changes to the AI parts, not on every pull request.
- **CI gate:** lint, typecheck, tests and build must pass before merge.
- **Prior art:** Petr's Booky monorepo (Turborepo, Hono, Drizzle, a test database, CI) is the reference for structure and test setup.

## Development Workflow

- Planning: a grilling session → PRD in `.plan/` → GitHub issues as thin vertical slices. All phase PRDs are worked out before implementation of phase 1 starts.
- Execution: one issue → one branch in its own worktree → developer subagent → tests → reviewer subagent → issue pull request → the orchestrator squash-merges it into the phase branch. One phase → one pull request to the main branch → Petr reviews and merges.
- A phase can run unattended: a script runs the orchestrator in a loop, one issue per iteration with a clean context, with all state kept in GitHub, waiting and retrying when the usage limit is reached, and with guards against spinning on a failing issue.
- Six agents by role: orchestrator, backend-developer, frontend-developer, ai-developer, reviewer (no write access to code) and docs-keeper. Knowledge specific to an app or package lives in that part's own `AGENTS.md`, not in more agents.
- Documentation is binding. A change in behaviour or structure updates the docs in the same pull request; the docs-keeper runs after each merge as a safety net.
- The orchestrator agent dispatches the others, run interactively or by the phase loop. No dedicated orchestration product is required; a different orchestrator can be tried in a later phase and compared in the README.
- Commits follow Conventional Commits. Each issue becomes one squashed commit on its phase branch; the phase branch reaches the main branch through one pull request merged by Petr. No agent ever merges into the main branch.
- Agent roles are recorded in the pull request description and commit trailers (implemented by, reviewed by, approved by). No separate GitHub accounts per agent.
- The goal is a transparent, high-quality engineering workflow, not a high count of AI commits.

## Repository Conventions

- Conversation with Petr is in Czech. Code, `AGENTS.md`, `docs/`, README and PRDs are in English.
- `.plan/` is committed. `.context/` holds raw working notes and is gitignored.
- Every app and package has its own `AGENTS.md`; there are no `CLAUDE.md` files.
- The root `AGENTS.md` holds the rules for agents: package boundaries, where test-first is mandatory, EDD, authenticated writes, responsive checks, commit and PR format.
- `docs/` holds architecture, design, workflow and decisions; it grows with the phases.
- `.claude/` holds project skills (`grill-me`, `to-prd`, `to-issues`, later content skills), rules that point agents to the relevant docs, hooks and permissions. Hooks and permissions are defined in `harness-prd.md` and `docs/permissions.md`.
- README sections: what the project is, architecture, how the assistant works, how MCP works, how retrieval is used, how development is orchestrated, agent roles, testing and review policy, licence.

## Out of Scope

- An admin UI or any login for humans.
- A second language.
- A contact form, blog, comments, newsletter.
- Separate pages for unreleased side projects.
- Advanced ML research or autonomous multi-agent products as offered services.
- Background workers until a concrete need appears.
- The future of the roadtoai.dev domain; a redirect may be added by Petr later.
- Production infrastructure before phase 10.
- Migrating the code of `road-to-matrix`. Its backend is rewritten on the new stack; its UI ideas and its data carry over.

## Open Questions

Deferred to the phase named in brackets.

1. Python generated-client placement and drift-check integration, using the committed content OpenAPI document and the generator guidance already delivered in phase 2. [06]
2. Final table and field names of the `profile` and `ai_roadmap` schemas, within the entities already defined. [02, 04]
3. Final headline wording checks and the Paldock role title. [03]
4. Whether Bunny's S3 compatibility must be chosen when a storage zone is created. [02]
5. How a usage limit is recognised from an unattended run. [harness]
6. Embeddings provider/model, measured retrieval settings and extraction limits. [09]
7. Security/main models and Python tooling [06]; Langfuse hosting and bot checks [07]; graph extraction/storage details [11]; Auto Ontology suitability [12]; verified MCP Apps/client support [13].
8. For the owner before launch: the server (existing or new), the production domain (the repository is named `sebela.dev`, the plan says sebelapetr.cz), the reverse proxy product, the monthly model budget, and the legal side of storing conversations. [10]

## Further Notes

- Raw content for Petr's private seed (timeline, Paldock material, side work with built / tested / designed labels, services) is collected in `.context/profile-notes.md`. It feeds the PRDs for phases 2 and 3.
- Services: process automation and integrations; custom software and internal tools; AI integration and internal AI tools. Consulting and training is not a separate service. The site states openly that software engineering is long-standing practice and the AI offering is newer. Availability is worded as "available for selected projects" with no specifics.
- Paldock is presented through public product information, Petr's role over time and technologies, including TimescaleDB. Internal use cases and implementation details are excluded.
- Petr has intensified work on the AI Roadmap since November 2026 (lectures, conferences, study); the profile says so.
