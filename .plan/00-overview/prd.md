# sebelapetr.cz — Overview PRD

| | |
|---|---|
| Status | Approved |
| Date | 2026-11-15 |
| Owner | Petr Šebela |
| Scope | Overview of the whole project. Each phase gets its own PRD in `.plan/NN-<phase>/prd.md`; those PRDs hold the detail (exact schema, endpoints, pages, tools) and must stay consistent with this document. |

## Problem Statement

Petr's current site, sebelapetr.cz, presents him as a "Web developer | Programmer" working mainly with PHP and Nette. Its content ends in 2024. It no longer matches what he does (Laravel, TypeScript, AI systems) or what he wants to be hired for.

He needs one professional site that works for two kinds of visitors at once:

- **Clients** (small and medium companies, software teams) who need to see what they can buy from him.
- **Employers** (recruiters, hiring managers, technical evaluators) who need to see his experience, how he works and where he is heading.

Separately, his learning roadmap lives in another application (Road to AI, `road-to-matrix`) on another domain, with a backend that grew through several rewrites. His CV is a separately maintained document. The same facts about him exist in several places and drift apart.

## Solution

A new sebelapetr.cz: a hybrid personal professional site built on one structured data model.

- One identity, two paths. Positioning: *software engineer focused on AI systems, automation and modern software — available for selected projects and career opportunities.*
- The site answers, in this order: who he is, what he can do, what he has built, what he is doing now, where he is heading, how to work with him.
- Every fact is stored once in PostgreSQL and reused by the website, the CV, the AI Roadmap, the chatbot and the MCP servers.
- The learning roadmap moves into the site as the **AI Engineering Roadmap** — "AI Roadmap" for short. These two are the only names used; "AI Engineering Path" and "Road to AI" are retired.
- Visitors and AI agents can ask about Petr: a chatbot on the homepage and a public MCP server, both answering only from his public data.
- The repository is open source and is itself part of the portfolio: it shows how he engineers and how he works with coding agents.

The site launches publicly once all phases are done and replaces the current sebelapetr.cz. The phases below organise the work; they are not public release milestones.

## Audiences

| Audience | What they need within 30 seconds | Primary path |
|---|---|---|
| Client | Whether Petr can solve their problem and what exactly he offers | Homepage → Services → Contact |
| Recruiter / hiring manager | Seniority, stack, recent work, CV | Homepage → Experience → CV |
| Technical evaluator | Depth: how he builds, tests and reasons | Experience and its case studies → repository |
| AI agent | Structured, trustworthy facts about Petr | Public MCP server, `llms.txt` |

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

Order of work: planning and the harness on `phase/00-overview` → the trial → fixes from the trial → phase 0 is merged into the main branch → phases 1 to 8, each processed by the loop and merged by the owner.

| # | Folder | Phase | Result |
|---|---|---|---|
| 0 | `00-overview` | Overview and harness | This document, the docs and agent rules, and the harness that lets later phases run unattended (`harness-prd.md`). Done by hand |
| 0 | `00-trial` | Trial | A dry run of the harness on practice issues. Ends with a pull request that is closed, not merged |
| 1 | `01-foundation` | Foundation | Turborepo, shared configuration, guard-rail checks, Docker Compose skeleton, full CI. The first phase processed by the loop. No application code |
| 2 | `02-api-db` | API and database | `apps/api`, `packages/db`, `packages/services`, `packages/contracts`, `profile` schema, seed |
| 3 | `03-web` | Website | `apps/web` with all presentation pages, CV, and a chat UI running on mock data |
| 4 | `04-ai-roadmap` | AI Roadmap | `ai_roadmap` schema, API, pages, import of the existing data |
| 5 | `05-mcp-admin` | MCP for content management | Secured MCP server that writes content through the API, plus agent skills that use it |
| 6 | `06-rag-memory` | Retrieval | The project's own retrieval over public data: pgvector, hybrid search, measured with evals |
| 7 | `07-llm-agent` | LLM agent: chatbot and public MCP | One Python service for the AI layer — the chat pipeline and the public read-only MCP server — and the real chatbot replacing the mock |
| 8 | `08-delivery` | Continuous delivery and launch | A version tag builds, verifies and deploys to the VPS; production Compose, reverse proxy, TLS, backups; loading the real data and switching the domain |

### Phase boundaries

**0 — Overview and harness.** Planning, the documentation, the agent rules and definitions, and the harness: the phase loop, worktree isolation, hooks, permissions, GitHub labels and branch rules, minimal CI. Built by hand, because the loop cannot build itself.

**0 — Trial.** The loop processes a handful of practice issues that exercise every path through it: a dependency, a reviewer rejection, an impossible issue, a HITL issue, a forbidden action. The phase pull request is inspected and closed without merging. The harness is not considered done until this passes.

**1 — Foundation.** The first phase processed by the loop. Monorepo, shared configuration, the import-boundary and no-hard-coded-endpoint checks, a Compose file with Postgres, per-worktree databases, the full CI pipeline, the hooks that need the toolchain, README with the licence split. Not included: any app or package with behaviour.

**2 — API and database.** The `profile` domain end to end on the backend: schema, migrations, repositories, services, HTTP API with an OpenAPI description, public read routes and private routes protected by an API key, the demo seed, test fixtures. Write endpoints exist from the start because phase 5 depends on them. Not included: any UI, the AI Roadmap domain.

**3 — Website.** Next.js frontend consuming the API: homepage, Experience (career timeline with projects and inline case studies, independent R&D, technologies, education), Services, the CV page, `/ask`. The chat is a real UI — conversation flow, streaming, sources, rich blocks — fed by prepared answers behind the same interface the real backend later implements. Design system and responsive behaviour are settled here. Not included: real LLM calls, AI Roadmap pages, generating the CV PDF.

**4 — AI Roadmap.** Everything the current Road to AI application shows — roadmap, learning diary with statistics, bookshelf, FAQ, glossary, followed sources, project ideas, reading guide — carried over one to one in look and behaviour, under `/ai-roadmap` with its own sub-navigation, on a newly designed `ai_roadmap` schema. One addition: Events (attended conferences, meetups, workshops, lectures), with their time counted in the diary and statistics. The existing data is converted by a repeatable one-off mapper kept outside the repository; the owner keeps using the old application until launch. The homepage's Exploring column switches to live roadmap data.

**5 — MCP for content management.** `mcp-admin`: a TypeScript MCP server deployed as an HTTP service, turning the API's private routes into about a dozen tools — task tools for daily jobs, general tools over a fixed list of entities. It holds no key; the caller's API key is passed on. The API gains a record of every write. Skills for routine content work (diary entry, event, profile update, CV reminder). The first phase developed evals-first.

**6 — Retrieval.** The project's own retrieval implementation — no Cognee, no separate vector database. Public content is split into chunks, embedded through a hosted embeddings API and stored with pgvector in the same Postgres; search combines vector similarity with full-text search. Developed evals-first: a set of questions with known sources decides between the variants, and the measurements are published. Indexing follows writes directly; no worker unless that stops being enough.

**7 — LLM agent.** One Python service for the whole AI layer: the chat pipeline (input guard, generation with read tools and search, output checks) and the public read-only MCP server, sharing one set of tools. The API gains conversations: visitor cookie, ownership, limits, bot detection, budget, storage. The website's mock is replaced. Evals for desired and forbidden behaviour; monitoring of real conversations.

**8 — Continuous delivery and launch.** Done last. A version tag builds the images, verifies the complete stack in the pipeline, deploys to the owner's server and rolls back on failure. Production only — no staging; the full-stack check and the rollback take its place. Production Compose stack behind a reverse proxy with TLS, backups with a rehearsed restore, monitoring. Then the launch: the owner's real data and the final roadmap import are loaded, and sebelapetr.cz is switched to the new site.

## Implementation Decisions

### Architecture

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

- The API is the only gateway to data. The website, `mcp-admin` and `llm-agent` are API clients over HTTP.
- The reason is security, not tidiness: the API is the trust boundary. The system has two MCP servers, write access for agents and a public chatbot. Authentication is enforced once, at that boundary, so no client can bypass it. This supersedes the earlier idea of MCP calling shared services directly.
- Only `apps/api` (and a future worker) may import `packages/db` and `packages/services`. A lint rule enforces this.
- Postgres is the source of truth. The retrieval layer is derived and can be rebuilt from Postgres at any time.

### Monorepo

- Turborepo with pnpm workspaces on the current Node LTS. TypeScript throughout, except `apps/llm-agent`, which is Python with its own toolchain and takes part in the same task pipeline and CI.
- Apps: `web` (Next.js, frontend only), `api` (Hono), `mcp-admin` (TypeScript), `llm-agent` (Python: the chat pipeline and the public MCP server). `mcp-admin` and `llm-agent` stay separate apps because their threat models differ: one can write, the other is public and read-only.
- No `worker` by default. It is added only for a concrete background job; the first likely one is phase 6 (a change in Postgres triggers an asynchronous reindex).
- Packages: `db` (Drizzle schema, migrations, repositories, seed), `services` (domain logic, storage), `contracts` (Zod schemas and types shared by API, web and MCP), `api-client` (typed client generated from the OpenAPI document), `ui` (shared React components and design tokens), `config` (shared lint and TypeScript configuration); later `memory` (retrieval).
- `packages/memory` is the retrieval layer: chunking, embedding, indexing and hybrid search on pgvector. The rest of the code calls index, search and delete operations only.

### Repository structure

The maintained reference is `docs/repository-structure.md`; it holds the full tree, the dependency table and the port scheme. In short:

```
apps/        web [3], api [2], mcp-admin [5], llm-agent [7]
packages/    config [1], db [2], services [2], contracts [2], api-client [2], ui [3], memory [6]
scripts/     worktree setup and cleanup, the phase loop, database helpers
docs/        architecture, design, workflow, decisions
.plan/       PRDs and issue overviews per phase
.claude/     skills, rules, agents, settings (hooks and permissions)
compose.yaml in the root; a Dockerfile inside each app
```

- Package scope is `@sebela/*`.
- The demo seed lives inside `packages/db`; the owner's private seed has the same format and is loaded from outside the repository by the same command.
- End-to-end tests live in `apps/web/e2e`, evals in the `evals/` folder of `mcp-admin`, `llm-agent` and `memory`; all other tests sit next to the code.

### Parallel work in worktrees

- Agents work in parallel, each in its own git worktree, sharing one Postgres container.
- A setup script gives each worktree a slot: its own database (named after the branch, migrated and seeded with the demo seed) and its own ports for the website, the API, `mcp-admin` and `llm-agent`, and in development its own folder in object storage, written to that worktree's `.env.local`. A cleanup script drops the database and frees the slot.
- Tests use a separate temporary database.
- No port, host or database name is hard-coded anywhere; everything comes from the environment, and CI checks it.

### Backend

- **Framework:** Hono. Built-in bearer authentication, CORS, security headers and streaming; OpenAPI generated from the same Zod definitions used for validation. Rate limiting through a separate middleware library; in-memory storage is enough until the chatbot phase.
- **ORM:** Drizzle. Schema in TypeScript, SQL migrations generated and committed, Zod schemas derived from tables.
- **Migrations:** applied by a dedicated one-off step before the API starts, never by the API on startup. No down migrations: fix forward, back up before deploy.
- **Database layout:** one Postgres database with separate schemas per domain — `profile` (person, organizations, experiences, projects and case studies, explorations, services, technologies, topics, education, testimonials, current focus, media), `ai_roadmap` (areas, modules, resources, diary and time entries, books, events, project ideas, followed sources, glossary), and separate schemas for API keys, the record of writes, retrieval and chat conversations. Domains are linked through shared topics and technologies.
- **API style:** REST. The OpenAPI document is generated automatically from the same Zod schemas the API validates with, and it is the contract for every client. Typed clients are generated from it — in TypeScript for the website and `mcp-admin`, and in Python for `llm-agent`. CI checks that the generated client is up to date.

### Files

- Images and the CV file live in object storage behind one interface: Bunny Storage through its S3-compatible API in development and production, local disk for tests, CI and environments without keys. One environment variable selects the driver.
- Development and production use separate storage zones with separate keys; development adds a folder per worktree.
- Uploads go through a private API route. The database stores the file's key; the public base address is configuration.
- Logos of technologies are static assets of the website.

### Access

- No user accounts and no login UI.
- The API has two groups of routes. **Public** routes need no authentication and are read-only — with one named exception from phase 7: a visitor may create and continue their own chat conversation. The website and `llm-agent` use them. **Private** routes are protected by an API key checked in middleware; every write is a private route.
- API keys are created with a command, shown once and stored only as a hash. Each has a name and can be revoked on its own; keys do not expire by themselves. A key is used by server-side callers only and never reaches a browser.
- There is no visibility model and API keys carry no scopes. Everything in the database is public content. A private flag is added only when a real use case needs it, and only where it is needed.
- Built / tested / designed status is a data field on explorations — a fact about the record, not an access rule — so that neither the site nor the chatbot overstates it.

### Content

- The database is the single canonical source of content. Nothing in the repository mirrors it.
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
- The chat starts from an input line in the hero and continues on `/ask`. A conversation is identified by a random identifier in the address and belongs to an anonymous visitor cookie; someone else with the link does not see it.
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

- The chatbot is a feature of the website, not a separate product. The UI is in `apps/web`; the conversation (visitor cookie, ownership, limits, budget, storage) is owned by `apps/api`; the answer is produced by `apps/llm-agent`.
- The pipeline of one question: limits and bot detection → an input guard (a small model: injection, off-topic, abuse) → generation by a model with read tools and search → deterministic output checks (structure, sources, links) → a streamed answer. Stored conversations are scored afterwards, off the visitor's path.
- No separate router: the generating model chooses between exact lookups and semantic search by calling tools.
- The assistant has no API key and no write tool, and nothing in the database is private. That is the strongest guardrail.
- Answers carry typed blocks — contact, experience, service, exploration, roadmap, sources — rendered by the website's own components. Where a client supports it, the public MCP server returns UI through the MCP Apps extension.
- Conversations are kept without a time limit, for analysis. The visitor's address is not stored with them.
- Models come from Anthropic or OpenAI, chosen at the start of phase 7 and confirmed by evals. Budget is capped twice: at the provider and in the backend.
- **Evals:** promptfoo in the repository, for desired and forbidden behaviour alike (grounding, unknown answers, direct and indirect prompt injection, unsupported claims, status integrity, source correctness, tool misuse). **Monitoring:** Langfuse for traces, cost and scoring of real conversations.
- Two MCP servers, in two separate deployables in the same Compose stack, both API clients: `mcp-admin` (secured, write) and the public read-only MCP server inside `llm-agent`.
- `mcp-admin` is written in TypeScript: it has many write tools with complex input and reuses the shared schemas and the generated client. The whole AI layer is one Python service, `llm-agent` (FastAPI, LangGraph): the chat pipeline and the public MCP server share one set of read tools. Its client is generated from the OpenAPI document, which also demonstrates that the contract works across languages. Python and LangGraph are what the market for AI engineering roles asks for.
- `mcp-admin` is deployed as an HTTP service. It holds no key of its own: the caller's API key is passed on to the API, which verifies it.

### Deployment

- Docker everywhere: a Dockerfile per app and one Compose stack (website, API, Postgres with pgvector, later `mcp-admin` and `llm-agent`). Local and production use the same composition.
- Target: Petr's own VPS.
- Reverse proxy, TLS, production Compose overrides, backups, deployment pipelines and the domain switch belong to phase 8, not phase 1.
- Releases are version tags on the main branch; there is no staging environment. A release is verified as a complete running stack in the pipeline before it is deployed, and a failed deployment rolls back.

### Licence

- Source code: MIT.
- Personal content, photographs, CV data, project descriptions and branding: © Petr Šebela, not covered by MIT. The README states this explicitly. The demo seed is fictional and is covered by MIT like the code.

## Testing Decisions

- **Strict test-first where correctness matters:** security, API contracts, services and domain logic, bug fixes. Tests are written first and must fail without the implementation; the reviewer agent checks this.
- **Evidence-first where appearance matters:** layout, typography and responsive polish are accepted on written acceptance criteria, Playwright checks and screenshots, and a visual review. A test written before the markup is not required there. The project exists to ship a good product, not to demonstrate a methodology.
- **Good tests check external behaviour**, not implementation: an HTTP request and its response, a rendered page, a tool call and its result.
- **Unit and integration:** Vitest for TypeScript; the Python test runner for `llm-agent` is chosen in phase 7. API tests run against a real Postgres, not mocks of the database.
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
- Production infrastructure before phase 8.
- Migrating the code of `road-to-matrix`. Its backend is rewritten on the new stack; its UI ideas and its data carry over.

## Open Questions

Deferred to the phase named in brackets.

1. The tool that generates typed clients from the OpenAPI document. [02]
2. Final table and field names of the `profile` and `ai_roadmap` schemas, within the entities already defined. [02, 04]
3. Final headline wording checks and the Paldock role title. [03]
4. Whether Bunny's S3 compatibility must be chosen when a storage zone is created. [02]
5. How a usage limit is recognised from an unattended run. [harness]
6. Embeddings provider and model. [06]
7. The two models (guard and generation), where Langfuse runs, the bot-detection mechanism, the outcome of the MCP Apps spike. [07]
8. For the owner before launch: the server (existing or new), the production domain (the repository is named `sebela.dev`, the plan says sebelapetr.cz), the reverse proxy product, the monthly model budget, and the legal side of storing conversations. [08]

## Further Notes

- Raw content for Petr's private seed (timeline, Paldock material, side work with built / tested / designed labels, services) is collected in `.context/profile-notes.md`. It feeds the PRDs for phases 2 and 3.
- Services: process automation and integrations; custom software and internal tools; AI integration and internal AI tools. Consulting and training is not a separate service. The site states openly that software engineering is long-standing practice and the AI offering is newer. Availability is worded as "available for selected projects" with no specifics.
- Paldock is presented through public product information, Petr's role over time and technologies, including TimescaleDB. Internal use cases and implementation details are excluded.
- Petr has intensified work on the AI Roadmap since November 2026 (lectures, conferences, study); the profile says so.
