# Phase 2 — API and database

| | |
|---|---|
| Status | Draft, awaiting approval |
| Date | 2026-11-15 |
| Parent | `.plan/00-overview/prd.md` |
| Depends on | Phase 1 |
| Result | The profile domain, complete on the backend: database, services, storage, an HTTP API with an OpenAPI contract, a generated typed client and a demo seed. No UI. |

## Problem Statement

Everything the site will show — who Petr is, where he worked, what he built, what he offers — has to live in one place and be reachable in one way. Today those facts are scattered across an outdated site, a CV and notes. Until there is a backend that stores them once and serves them through a defined contract, neither the website nor the CV nor any agent can be built on solid ground.

## Solution

A backend for the profile domain:

- a `profile` schema in PostgreSQL holding every fact once,
- an API that serves it — public routes for reading, private routes for writing — described by an OpenAPI document generated from the same schemas it validates with,
- a typed client generated from that document for the website and the admin MCP server (the Python LLM agent generates its own from the same document in phase 7),
- object storage for images and the CV file behind one interface,
- a demo seed with a fictional person so that every environment has realistic data, and a way to load the owner's real data from outside the repository.

After this phase the website can be built against a running, documented API.

## User Stories

### Reading (website, later the public MCP server and chatbot)

1. As the website, I want to read the person's profile, so that I can render the hero and contact details.
2. As the website, I want to list experiences with their organization, dates, kind, description and technologies, so that I can render the timeline.
3. As the website, I want each experience to come with its projects, and to know which projects are selected for the homepage, so that I can render them inside the timeline and show the strongest ones first.
4. As the website, I want a project's case study together with the project, so that I can expand it inside its experience.
5. As the website, I want to list explorations with their status and concepts, so that I can render the independent R&D block without overstating anything.
6. As the website, I want to list services with who each is for, what the client gets and the evidence for it — projects, explorations and links — so that I can render the services page.
7. As the website, I want to list technologies by tier and group, so that core ones are shown with logos and the rest as text.
8. As the website, I want to read education, the current focus, and each testimonial with the experience it belongs to, so that I can render the remaining sections.
9. As the website, I want one call that returns everything a CV needs, already assembled, so that the CV page only renders.
10. As the website, I want image records with a public address, dimensions and alt text, so that I can render images correctly.
11. As any client, I want every list returned in its intended order, so that I do not sort by guesswork.
12. As any client, I want errors in one shape, so that I handle them in one place.

### Writing (the owner's agents)

13. As a content agent, I want to create, update and delete every kind of profile record, so that the whole profile can be managed without touching the database.
14. As a content agent, I want to set the relations of a record (technologies of an experience, the evidence of a service) in the same write, so that a record is never half-linked.
15. As a content agent, I want to upload an image or a PDF and get back a record I can attach, so that files are managed like any other content.
16. As a content agent, I want invalid input rejected with a message naming the field, so that I can correct it without guessing.
17. As a content agent, I want to address records by a stable slug, so that I can refer to "paldock" rather than an identifier.
18. As the owner, I want every write to require an API key, so that nobody else can change my content.
19. As the owner, I want to create a named API key with a command, see it once, and revoke any key on its own, so that I control access without an account system and without tokens that expire in the middle of work.

### Contract and clients

20. As a client developer, I want an OpenAPI document that is always in step with the API, so that I never work from stale documentation.
21. As a client developer, I want a typed client generated from that document, so that a contract change fails my build instead of my runtime.
22. As a developer of a Python client, I want the same document to be enough to generate my client, so that the contract does not depend on TypeScript.
23. As a reviewer, I want CI to fail when the generated client is out of date, so that the contract and the clients cannot drift.
24. As a visitor to the repository, I want a browsable API reference served by the API, so that I can explore it.

### Data and environments

25. As a development agent, I want a demo seed with a fictional person of realistic shape and volume, so that I can build and check my work without real data.
26. As the owner, I want to load my real data once from a folder outside the repository with the same command, so that my content never enters git.
27. As a developer, I want to run the seed repeatedly without duplicates, so that I can refresh an environment safely.
28. As the orchestrator, I want a new worktree to come up migrated and seeded, so that an agent can start immediately.
29. As a developer, I want images stored on local disk when no storage keys are configured, so that tests, CI and a fresh clone need no cloud account.
30. As the owner, I want development and production images in separate storage zones with separate keys, so that a mistake in development cannot touch production files.
31. As a developer agent, I want an `AGENTS.md` in each backend app and package, so that I know how to add an entity, a route or a migration there.

## Implementation Decisions

### Modules

| Module | Lives in | Interface |
|---|---|---|
| Schema and migrations | `db` | The `profile` tables and their relations |
| Repositories | `db` | Read and write operations per entity; the only place with SQL |
| Profile services | `services` | Operations on entities; assembling the CV |
| Storage | `services` | Store a file, delete it, give its public address; two drivers behind one interface |
| Authentication | `api` and `services` | Middleware on the private route group; commands to create, list and revoke API keys |
| HTTP API | `api` | Routes per entity, one error shape, the OpenAPI document |
| Contracts | `contracts` | Zod schemas and types for every request and response |
| Generated client | Decided below | A typed client produced from the OpenAPI document |
| Seed | `db` and `services` | One command that loads a seed folder from any path |

Storage is the deepest of these: three operations hide the driver, the key layout, the per-environment prefix and the public address.

### The `profile` schema

Every table has an identifier, timestamps and, where order matters, a position. Records that are addressed from outside have a unique slug. Longer texts are markdown.

| Entity | Holds | Relations |
|---|---|---|
| Person | Name, headline, short bio, long bio, location, email, links, availability wording, date the career started | Photo (media); current CV file (media). One record |
| Organization | Name, website, description | Logo (media) |
| Experience | Title, kind (main job, side project, own business), start and end (open end means current), summary, responsibilities, whether it appears in the CV | Organization; technologies; projects |
| Project | Name, summary, problem, what was done, result, period, links, whether it is selected for the homepage | The experience it belongs to; cover (media); technologies |
| Case study | Long-form body, the person's role | One per project |
| Exploration | Name, summary, status (built, tested, designed), list of concepts, period | Technologies; topics |
| Service | Name, summary, who it is for, what the client gets | Evidence: projects, explorations, and links to other parts of the site |
| Technology | Name, tier (primary, secondary), group for primary ones (core, AI engineering focus), optional logo key | — |
| Topic | Name | Links to the AI Roadmap in phase 4 |
| Education | Kind (school, course, certification, milestone), title, institution, period, description | — |
| Testimonial | Quote, author, author's role | The experience it belongs to |
| Current focus | Title, description, link | Project (optional); topics |
| Media | Storage key, type, size, dimensions (images), alt text | Referenced by person, organization, project. Images and PDF documents |

- The logo of a technology is a key into a fixed set of static assets shipped with the website, not an uploaded file.
- There is no visibility field anywhere. Everything stored is public content.
- A project always belongs to an experience; it is shown inside it and, when selected for the homepage, links to that experience's place on the Experience page. There is no separate listing of projects.
- Deleting a record that others reference is refused with a clear error rather than cascading silently, except for pure link rows.

### API

- REST under a version prefix. Resources follow the entities.
- **Public routes:** read-only, no authentication — list and detail for each entity, the person, and the assembled CV.
- **Private routes:** every create, update and delete, and the image upload. Protected by API-key middleware applied to the whole private group, never per handler.
- Lists are small and are returned complete, in their defined order. No pagination in this phase.
- Detail routes accept a slug.
- Relations are written together with their owning record.
- One error shape for all failures, with a machine-readable code and, for validation errors, the offending fields.
- The OpenAPI document is generated from the Zod schemas in `contracts`, served by the API together with a browsable reference.
- A health route for Compose and, later, deployment.
- Rate limiting is applied to public routes with in-memory storage; limits that protect LLM cost come in phase 7.
- After a successful write the API has one place where interested parties can be notified. It does nothing yet; the website's cache invalidation attaches there in phase 3.

### Authentication

- Private routes require an API key sent as a bearer token.
- A key is a long random value with a recognisable prefix. It is shown once, when it is created; the database stores only its hash, together with a name, the creation time, the time of last use and, if revoked, when.
- Commands create, list and revoke keys. Several keys can exist at once — one per caller — and each is revoked on its own.
- Keys do not expire by themselves: an agent's connection must not break in the middle of work because a token ran out. Revocation is the control.
- Verification hashes the presented value and compares it in constant time.
- No accounts, no scopes. A key table lives in its own schema, apart from content.

### Generated client

- Produced from the OpenAPI document by a generator chosen at the start of the phase after checking the options against the current documentation.
- It lives in its own package so that the website and a TypeScript MCP server depend on the contract, not on the API's source.
- A CI step regenerates it and fails if the result differs from what is committed.

### Storage

- One interface: store, delete, public address.
- **Driver `bunny-s3`:** Bunny Storage through its S3-compatible API, using an existing S3 client library rather than hand-written request signing. Whether S3 compatibility must be chosen when a zone is created is verified in Bunny's documentation before the zones are made.
- **Driver `local`:** files on local disk, served by the API. Used by tests, CI and any environment without keys.
- The driver is selected by one environment variable; the example environment file documents both values.
- Two Bunny zones with separate keys: one for development, one for production. The production key exists only on the server.
- Key layout: an environment folder, then a per-worktree folder in development, then the file. The worktree scripts create and remove the per-worktree prefix alongside the database.
- The database stores the key only. The public base address comes from configuration, so changing the CDN is not a data migration.
- Uploads go through the API. Direct-to-bucket uploads are not offered: they would bypass the trust boundary.
- Upload validation: allowed image types and PDF, with a size limit; for images the dimensions are read and stored. The CV is a PDF prepared and uploaded by the owner, not generated.
- Resizing and format conversion are decided in phase 3.

### Seed

- One command loads a seed folder from a given path. The demo seed is the default path; the owner's private seed is passed explicitly and lives outside the repository.
- The seed is a set of data files in one documented format, validated with the same schemas as the API, plus image files.
- It writes through the services in-process, not over HTTP, so it needs no running server. This is the one sanctioned exception to "everything through the API", and it lives inside the backend.
- It is idempotent: records are matched by slug, so repeated runs update instead of duplicating.
- The demo seed describes a fictional person with a realistic number of experiences, projects, explorations, services and technologies, and a few placeholder images.

### Environments and tooling

- Migrations run as a dedicated step, never from the API on start-up.
- The worktree setup script now also runs migrations, loads the demo seed and prepares the storage prefix; cleanup removes them.
- The API gets a Dockerfile and a Compose service, together with a one-off migration service that completes before the API starts.
- Each of `api`, `db`, `services` and `contracts` gets its own `AGENTS.md`: how to add an entity end to end, how to write a migration, how to run its tests.
- `docs/code-standards.md` is revised with what the first real code settles.

## Testing Decisions

- A good test here goes through the public interface: an HTTP request and its response, a service call and its result. It does not assert on SQL or internal calls.
- **Test-first, mandatory:**
  - every route's contract — status, shape, ordering, error shape;
  - authentication — one test walks every registered route and asserts that each write and each private route returns 401 without a valid key, so a new route is covered automatically; a revoked key is refused; the stored value is a hash and the key itself cannot be read back;
  - profile services, including the CV assembly;
  - storage, against the `local` driver: store, delete, public address, key layout, rejected types and sizes;
  - the seed — the demo seed loads into an empty database, and a second run changes nothing.
- **Integration tests run against a real Postgres**, each in its own temporary database, with small fictional fixtures — never the demo seed.
- **One test for the `bunny-s3` driver**, run only when keys are present, so CI needs no secrets.
- **Migrations** are applied to an empty database in CI.
- **The generated client** is checked for staleness in CI.
- **Prior art:** the Booky monorepo for Hono with OpenAPI, Drizzle, a test database and CI.

## Out of Scope

- Any UI, including the website's use of the client.
- The `ai_roadmap` schema and its API (phase 4).
- The admin MCP server and the record of writes (phase 5); the LLM agent and chat conversations (phase 7).
- Image resizing and format conversion (phase 3).
- Cache invalidation of the website (phase 3); only the attachment point exists.
- Pagination, filtering and search.
- A visibility or draft model.
- Production storage zone set-up and deployment (phase 8).

## Further Notes

- Raw material for the owner's private seed is in `.context/profile-notes.md`. Turning it into seed files is done with the owner, outside the loop, because it is a content decision rather than an implementation task.
- Open content questions that do not block this phase: the wording of the headline and the Paldock role title, whether to offer consulting and training. They are settled in phase 3. Paldock content is limited to public product information, roles and technologies; internal use cases and implementation details are excluded.
