# Phase 2 — API and database

| | |
|---|---|
| Status | Approved |
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
9. As the website, I want one call that returns everything a CV needs, including concise explorations with their actual status, already assembled, so that the print-friendly CV page only renders while the separately uploaded PDF remains manually maintained.
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
19. As the owner, I want CLI commands to create, list and revoke named API keys from the first protected API slice, see each new key once, and revoke any key on its own, so that I can bootstrap and control access without an account system, a running API or tokens that expire in the middle of work.

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
32. As a developer or coding agent, I want one documented and enforced deep-module convention across agent instructions, documentation and Claude rules, so that I can find a module's interface, understand its guarantees and change its implementation without spreading knowledge across callers.

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
| Generated client | `api-client` | A typed client produced from the OpenAPI document |
| Seed | `db` and `services` | One command that loads a seed folder from any path |

Storage is the deepest of these: three operations hide the driver, the key layout, the per-environment prefix and the public address.

### Deep modules and source layout

The owner has agreed to the `src/modules/` convention for phase 2. Keep the existing app and package dependency rules. Within handwritten backend code, use `src/modules/<module-name>/index.ts` as a module's public entry; in particular, profile services live in `packages/services/src/modules/profile/`. Use `src/index.ts` for a package's explicit public exports. Startup, configuration, HTTP middleware and CLI adapters live outside `modules/`; database migrations and seed data retain their dedicated locations. Generated client code stays in its generated directory. Do not scaffold future modules.

The agreed phase 2 layout is:

```text
apps/api/src/
  app.ts                            # compose public/private groups and middleware
  server.ts                         # validated startup configuration
  middleware/
    authentication.ts
    rate-limit.ts
    error-handler.ts
  cli/api-keys.ts                    # calls services, never db directly
  modules/
    profile/index.ts                # HTTP route registration
    media/index.ts                  # HTTP route registration

packages/services/src/
  index.ts                          # explicit package exports
  modules/
    profile/index.ts                # profile operations and assembled CV
    profile/experiences.ts
    profile/projects.ts
    profile/cv.ts
    media/index.ts                  # validated uploads and media lifecycle
    storage/index.ts                # store, delete, public address
    storage/drivers/local.ts
    storage/drivers/bunny-s3.ts
    api-keys/index.ts               # create, list, revoke, verify

packages/db/src/
  index.ts                          # persistence operations, no exported SQL handles
  modules/
    profile/index.ts                # repositories; media belongs to profile schema
    profile/schema.ts
    profile/repositories/
    api-keys/index.ts               # key persistence in its separate DB schema
    api-keys/schema.ts
    api-keys/repository.ts

packages/contracts/src/
  index.ts                          # explicit package exports
  errors.ts
  modules/
    profile/index.ts                # request and response schemas
    media/index.ts                  # upload and media schemas

packages/api-client/src/
  index.ts                          # public generated-client entry
  generated/                        # generator-owned implementation
```

Each app/package above has an `AGENTS.md` at its root. Committed SQL migrations live in `packages/db/migrations/`, and the fictional demo seed lives in `packages/db/seed/demo/`. Tests are colocated with the code they verify, for example `profile/cv.test.ts` beside `profile/cv.ts`. Additional profile resources are added inside the owning profile module as they are implemented.

Module entry locations are fixed by this convention; the internal filenames illustrate the agreed responsibilities and may evolve without changing those entries. Each module may contain implementation files and colocated tests. A source module does not necessarily correspond to a PostgreSQL schema or a table. Subdivide `profile` when cohesive operations justify it; do not create a module or a controller/service/repository class for every table by default. The same domain can have an HTTP adapter, domain logic and persistence in different packages; their responsibilities remain distinct.

This layout and its enforcement are delivered by the standalone issue below. The folder convention is this project's choice; module depth comes from the information hidden behind its interface.

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
- Request bodies, path parameters and any supported query parameters are validated with explicit Zod schemas from `contracts`. Writable fields are allowlisted; unexpected fields and invalid types, lengths, formats or references are rejected rather than passed through to persistence. JSON routes reject unsupported content types and malformed JSON with the common error shape.
- One error shape for all failures, with a machine-readable code and, for validation errors, the offending fields.
- The OpenAPI document is generated from the Zod schemas in `contracts`, served by the API together with a browsable reference.
- A health route for Compose and, later, deployment.
- Rate limiting covers every route, including public reads, private writes, uploads, the API reference, the OpenAPI document and health checks. Separate policies keep health checks usable and apply tighter limits to authentication attempts and uploads. A coarse per-client limit runs before API-key verification so missing or invalid keys cannot bypass it; authenticated callers also have a per-key budget.
- Rate-limit thresholds and windows come from configuration. This phase uses bounded in-memory storage for one API instance; horizontal scaling requires shared counters. Client addresses come from the connection or an explicitly trusted proxy configuration, never arbitrary forwarded headers. Exhausted limits return `429`, `Retry-After` and the common error shape. Limits that protect LLM cost come in phase 7.
- Request body and upload size limits are enforced while receiving data, before unbounded buffering or expensive processing.
- No browser needs cross-origin API access in this phase, so CORS is disabled. If a later client needs it, allowed origins are configured explicitly. Origin and CORS never substitute for authentication; server-side callers are not required to send an Origin header.
- Errors expose no stack traces, SQL details or secrets. Responses declare the correct content type and use `X-Content-Type-Options: nosniff`; deployed API access uses HTTPS, with TLS termination configured in phase 8.
- After a successful write the API has one place where interested parties can be notified. It does nothing yet; the website's cache invalidation attaches there in phase 3.

### Assembled CV and the downloadable PDF

- The public CV endpoint assembles the data for the print-friendly `/cv` page, distinct from the more detailed `/experience` page. The pages are implemented in phase 3.
- The CV response includes the person and contacts, summary, experiences selected by the CV flag, concise explorations with their actual built/tested/designed status, technologies in their defined groups, education and metadata for the current uploaded CV PDF when present. Explorations remain a distinct section, never career experiences or delivered client projects. Phase 3 may show all three statuses, with designed explicitly labelled as unimplemented and never used as evidence of delivered work or hands-on experience.
- The downloadable PDF is a separate, manually prepared media upload referenced by the person. Updating profile content or the assembled CV response does not regenerate that file. No PDF rendering or generation is added in this phase.

### Authentication

- Private routes require an API key in the `Authorization: Bearer <api-key>` header. The token is the API key itself, not a JWT; there is no login or token-exchange endpoint. Keys are never accepted in URLs or query parameters, never sent to browser code and are redacted from application and request logs.
- A key is a long random value with a recognisable prefix. It is shown once, when it is created; the database stores only its hash, together with a name, the creation time, the time of last use and, if revoked, when.
- CLI commands create, list and revoke keys. They are delivered with the first protected API slice, before profile CRUD and uploads depend on them. They run inside the backend through services, require database access but no running HTTP server or pre-existing API key, and are documented with copyable commands. Listing returns metadata only, never a key or its hash. Several keys can exist at once — one per caller — and each is revoked on its own.
- Keys do not expire by themselves: an agent's connection must not break in the middle of work because a token ran out. Revocation is the control.
- Verification hashes the presented value and compares it in constant time.
- Missing, malformed, unknown and revoked keys are refused with the same `401` error shape. Authentication middleware guards the entire private route group before request-body validation or handler execution; an unsuccessful request cannot change content or store files. Revocation takes effect on the next request.
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
- Upload validation: an explicit allowlist of image formats and PDF, with a size limit. Verify the actual file signature and, for images, decode enough to validate the image and read its dimensions; bound image dimensions and processing work. Do not trust the filename extension or caller-supplied MIME type. Reject unsupported or mismatched files with the common error shape. The CV is a PDF prepared and uploaded by the owner, not generated.
- Storage keys are generated by the backend. Client-supplied filenames cannot select a path, escape the configured local root or worktree prefix, or overwrite another file. Rejected uploads leave no media record or stored file.
- Resizing and format conversion are decided in phase 3.

### Seed

- One command loads a seed folder from a given path. The demo seed is the default path; the owner's private seed is passed explicitly and lives outside the repository.
- The seed is a set of data files in one documented format, validated with the same schemas as the API, plus image files.
- It writes through the services in-process, not over HTTP, so it needs no running server. The seed loader and API-key management CLI are backend maintenance commands, the explicit exceptions to client access through the HTTP API; neither gives web, MCP or LLM clients direct database access.
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
  - authentication — one test walks every registered route and asserts that each write and each private route returns 401 without a valid key, including for invalid bodies and content types, so a new route is covered automatically. Use non-exhausted rate-limit budgets for this property. Missing, malformed, unknown and revoked keys are refused without side effects; a valid key permits the operation and revocation rejects its next request. The stored value is a hash and the key itself cannot be read back;
  - API-key CLI — create the first key against a migrated database without an HTTP server or an existing key, use it on a private route, list metadata without secrets, revoke it and verify rejection. A generated key is shown only when created, never included in later output or logs;
  - validation and error handling — invalid body, path and supported query input, unexpected writable fields, malformed JSON, unsupported content types and oversized requests receive the documented errors without writes or leaked internal details;
  - rate limiting — every registered route has a policy; public reads, valid and invalid authentication attempts, private writes, uploads and health checks respect their budgets, return `429` with `Retry-After` when exhausted and recover after the window. Test caller isolation, proxy-header spoofing and bounded counter cleanup with a controlled clock;
  - profile services, including the CV assembly;
  - storage, against the `local` driver: store, delete, public address, key layout, rejected types and sizes, spoofed MIME types and extensions, malformed images, excessive dimensions and path traversal attempts; rejected uploads leave no files or media records;
  - the seed — the demo seed loads into an empty database, and a second run changes nothing.
- **Integration tests run against a real Postgres**, each in its own temporary database, with small fictional fixtures — never the demo seed.
- **One test for the `bunny-s3` driver**, run only when keys are present, so CI needs no secrets.
- **Migrations** are applied to an empty database in CI.
- **The generated client** is checked for staleness in CI.
- **Prior art:** the Booky monorepo for Hono with OpenAPI, Drizzle, a test database and CI.

## Planned standalone issue — Establish the deep-module standard and enforce its imports

### Parent and scheduling

- Parent: this PRD, story 32; supports story 31 and all backend implementation stories.
- Type: AFK, backend developer, with reviewer and documentation review under the normal issue workflow. The issue explicitly includes shared lint configuration and agent instructions.
- Blocked by: phase 1, including its repository import-boundary checks.
- Blocks: the first phase 2 implementation slice and subsequent backend slices.
- Published as [#22 — Establish the deep-module standard and enforce module imports](https://github.com/sebelapetr/sebela.dev/issues/22), separately from the final handoff verification. The complete approved phase breakdown is in [issues.md](issues.md).

### What to build

Turn the existing deep-module principle into a usable repository standard before backend code is introduced. Keep the approved packages and trust boundary. Establish the source layout above, document module responsibilities and enforce imports mechanically. Deliver the convention and fixture-based enforcement together; later issues create real modules as their functionality is implemented.

Use `docs/code-standards.md` as the canonical explanation, `docs/repository-structure.md` for placement and import rules, and `docs/architecture.md` for responsibilities and composition. Root `AGENTS.md` and `.claude/rules/deep-modules.md` carry short instructions linking to those documents. Extend `.claude/rules/documentation.md` so an agent changing a module knows which documents to read. Backend package instructions added in later issues include their actual module map and public entries. Keep project terms such as API, services, repositories and trust boundary; external vocabulary does not rename established concepts.

### Standard to document

1. **Define the job and what is hidden.** Before adding or changing a module, name the caller's operation, its inputs/results, its guarantees and the knowledge it owns. A module should remove decisions from callers. For example, the media operation owns upload checks and cleanup; the storage module owns drivers and key handling; API-key operations own generation, hashing and revocation.
2. **Design the whole interface.** Document relevant errors, side effects, atomicity, required configuration and ordering constraints alongside exported operations. Callers should not need private implementation knowledge to use an operation correctly. Internal helpers may be small; depth is judged by what callers gain, not line counts or directory depth.
3. **Use explicit entries.** Within one package, another module and composition code import a module only through its `index.ts`. Imports inside the same module may use its private files. Across packages, callers use only declared package exports, initially the root entry; no relative paths into another package or undeclared subpath imports. Entries export deliberately selected operations and types rather than every implementation symbol.
4. **Preserve the trust boundary.** API modules adapt HTTP to services; services own domain behaviour; db owns SQL. Do not return Drizzle tables, query builders, transactions, raw connections or Bunny SDK objects to API or client callers. Any internal transaction facility belongs behind db's public persistence operations, so services can request atomic writes without managing SQL primitives. Shared request/response contracts remain independent of services and db.
5. **Compose dependencies once.** Validated runtime configuration and resource creation happen at backend composition/startup, with a corresponding composition path for maintenance CLI commands. Runtime modules receive what they need; they do not repeatedly read environment variables or create hidden clients. Module dependencies are acyclic and use public entries.
6. **Keep abstractions useful.** Before adding an intermediate wrapper, describe the decisions it removes from its callers. If removing it would simply remove forwarding code, prefer fewer layers. Retain adapters required for HTTP, storage drivers and security even when they are small. Introduce replaceable-driver abstractions for concrete variation, such as local and Bunny storage; do not invent a generic repository framework or additional adapters for imagined future needs.
7. **Verify observable behaviour.** Follow the existing test-first rules. Exercise module behaviour through its interface and preserve these tests during internal refactors. Internal pure helpers may have focused tests without becoming public exports. Database integration tests still use real Postgres. Tests do not depend on private call sequences or mock every internal step.
8. **Leave a navigation trail.** Each backend app/package `AGENTS.md` lists module paths, public entries, responsibilities, dependency direction and relevant test commands as modules arrive. An agent using a module starts with this map, its entry documentation and behaviour tests; it reads internals when the task needs them. Update the map when adding, moving or changing an interface.

The primary rationale is information hiding and limiting the knowledge callers must carry. Ousterhout explains this in [Modular Design](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign). Matt Pocock's [codebase-design reference](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md) also emphasizes useful interfaces, local reasoning, behavioural test surfaces and questioning forwarding layers. The concrete folders, exports, checks and responsibility rules above are adaptations to this repository. They do not imply a measured improvement in coding-agent performance.

### Wording for root AGENTS.md

Add a short architecture instruction linked to the canonical documents:

> Design deep modules: expose a small, documented interface that hides a complete responsibility. Put handwritten backend modules in `src/modules/<name>/` with an explicit `index.ts`; other modules use that entry, and other packages use declared package exports. Keep dependencies acyclic and preserve the API trust boundary. Keep driver details, SQL and internal workflows behind their owning interfaces. Follow `docs/code-standards.md`, `docs/repository-structure.md` and `docs/architecture.md`; maintain the module map in the relevant app/package `AGENTS.md`.

### Wording for .claude/rules/deep-modules.md

Create a short, always-loaded rule that points to the canonical documents rather than duplicating their full content:

> Before designing or changing a module, read the Structure section of `docs/code-standards.md`, the module layout/import rules in `docs/repository-structure.md` and the relevant app/package `AGENTS.md`.
>
> State the caller's operation and the decisions the module hides. Use `src/modules/<name>/index.ts` as its entry, and never import another module's private files. Preserve package dependency rules and the API trust boundary. Document guarantees and errors at the interface, verify observable behaviour, and update the module map. Prefer cohesive operations over forwarding layers; folder nesting alone does not establish a deep module.

### Acceptance criteria

- [ ] Root `AGENTS.md`, the three canonical documents, `.claude/rules/documentation.md` and the new `.claude/rules/deep-modules.md` agree on the convention, retain valid links and preserve the existing package dependency table.
- [ ] Canonical docs contain the phase 2 layout, composition/CLI placement, explicit entry rules, private implementation examples and a short example contrasting a cohesive operation with caller-managed implementation steps.
- [ ] Extend the existing lint/import-boundary mechanism, with failing fixtures first, to reject cross-module private imports, cross-package source imports and circular module dependencies. Cover supported static imports, type imports, re-exports and literal dynamic imports, including relative and configured alias paths; keep a narrow documented provision for framework tooling that runs within its own package.
- [ ] Positive fixtures demonstrate private imports inside one module, another module using its public entry, composition code using entries and allowed package-root imports. Negative fixtures demonstrate bypasses and cycles. Fixtures do not create placeholder apps/packages or load real credentials.
- [ ] The normal lint command and CI execute these checks. The issue states any dependency added and its reason; it does not weaken the phase 1 checks. Tool limitations are documented, and the reviewer verifies behavioural information hiding separately from syntactic import enforcement.
- [ ] A reviewer can use the docs to locate an interface, understand permitted dependencies and identify where a future change belongs. The review checks that an operation removes caller knowledge and that no SQL or driver primitive leaks through the boundary.
- [ ] The instructions establish a module-map requirement for backend app/package `AGENTS.md` files created by subsequent issues. This issue creates no future app/package placeholders and does not refactor the dependency-free Node harness into the new layout.

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
