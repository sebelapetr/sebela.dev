# Phase 5 — MCP for content management

|            |                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Approved in conversation; implementation pending                                                                                                                  |
| Date       | 2026-11-18                                                                                                                                                        |
| Parent     | `.plan/00-overview/prd.md`                                                                                                                                        |
| Depends on | Phases 2 and 4                                                                                                                                                    |
| Result     | The owner manages all content by talking to an agent: a secured MCP server over the API's private routes, the skills that use it, and evals that prove it behaves |

## Problem Statement

There is no admin UI, by decision. After phase 4 the only ways to change content are the seed command and raw API calls. Logging a study session, adding an event or correcting a sentence in an experience must be as easy as saying it — otherwise the content goes stale, and stale content is the failure this whole project is meant to prevent.

The capability is also dangerous: whatever can write the profile can also wreck it. The owner reaches it inside the server network or through an authenticated SSH tunnel; it is not an internet-facing administration service.

## Solution

`mcp-admin`: an MCP server, deployed next to the API, that turns the API's private routes into a small set of tools an agent can use well.

- A few task tools for what is done every day, a few general tools for everything else.
- It holds no database credentials or shared privileged content key. The API verifies the caller's dedicated administrative credential for every operation.
- Every write is recorded.
- Project skills describe the routine jobs, so that any agent session does them the same way.
- It is developed evals-first: the cases that define good behaviour are written and agreed before the tools.

## User Stories

### Owner, daily use

1. As the owner, I want to say what I studied, when and what I learned, and have the diary entry and the time record created, so that logging takes seconds.
2. As the owner, I want the agent to find the right resource from a name or a link, and to ask me when two match, so that time is never logged to the wrong thing.
3. As the owner, I want to add a resource on the spot when I studied something that is not in the roadmap yet.
4. As the owner, I want to mark a resource as started, completed, paused or skipped.
5. As the owner, I want to add an event I attended with what I took away, and record the time I spent there.
6. As the owner, I want to add a book and move it between to read, reading and completed, with a summary when I finish.
7. As the owner, I want to correct or extend any part of my profile — a headline, an experience, a project, a service, an exploration — by describing the change.
8. As the owner, I want to upload a photo, a logo or a new CV file and attach it.
9. As the owner, I want to be reminded to replace the CV file when I change something the CV shows.
10. As the owner, I want to ask what is currently stored before I change it, so that I edit with the facts in front of me.
11. As the owner, I want changes to appear on the site within seconds.

### Owner, safety

12. As the owner, I want nothing deleted unless I asked for exactly that, so that an agent's misreading cannot remove content.
13. As the owner, I want the agent to ask rather than guess when my instruction is ambiguous.
14. As the owner, I want a record of every write — what changed, when, through which tool and with which key — so that I can see what an agent did and undo a mistake.
15. As the owner, I want a request without a valid key refused before it learns anything, including which tools exist.
16. As the owner, I want to revoke one key and know that client is cut off immediately.
17. As the owner, I want the server to be unable to do anything my API key could not do, so that it adds no power of its own.
18. As the owner, I want to connect from Claude Code or a similar tool on any machine with one address and one key.

### Agent

19. As an agent, I want tool descriptions that say when to use each tool and when not, so that I pick correctly.
20. As an agent, I want to ask the server for the shape of an entity, so that I can fill in a write correctly without guessing field names.
21. As an agent, I want validation errors that name the field and the reason, so that I can fix my call.
22. As an agent, I want destructive tools marked as such, so that my client can ask the person first.
23. As an agent, I want skills for the routine jobs, so that I follow the owner's conventions.

### Development

24. As a developer agent, I want the eval cases to exist before I write a tool, so that I know what the tool has to achieve.
25. As a reviewer, I want evals to check the resulting state of the data, not the wording of a reply, so that passing means the job was actually done.
26. As the owner, I want to approve the list of eval cases, because they are the definition of correct behaviour.

## Implementation Decisions

### Deployment and transport

- A separate TypeScript HTTP app in the Compose stack. Bind it to the internal server network or loopback; remote owner access uses an authenticated SSH tunnel. No public admin subdomain or unauthenticated tunnel endpoint is created.
- Private content-write routes receive the same network restriction. A public API hostname must not provide a second route around the private MCP boundary. Public content reads and the narrowly scoped visitor-conversation routes remain public.
- API authentication is required even on the internal network and through a tunnel. Service addresses, trusted proxies and tunnel targets are configuration; do not hard-code them.
- It reaches data only through the TypeScript content API over HTTP, using the generated client and shared schemas. It does not call FastAPI or the Python chat pipeline; the external agent supplies its own model. The separate Python `mcp-public` adapter is delivered in phase 8.

### MCP implementation stack

- Use the official TypeScript MCP SDK (`@modelcontextprotocol/server`), its official Hono adapter (`@modelcontextprotocol/hono`) and Hono for Streamable HTTP. Pin compatible exact versions during the first implementation slice. Hono is the HTTP/middleware layer; SDK handles MCP. Do not hand-write JSON-RPC or introduce a separate REST endpoint for every tool.
- This reuses the HTTP framework already used by `apps/api`; it does not duplicate the content REST API. See the [official Hono adapter](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/middleware/hono/README.md).
- Install application authentication and bounded-request controls before MCP dispatch; SDK defaults do not replace authorization, rate limits or API validation.

### Security

- The caller supplies `Authorization: Bearer <api-key>` to MCP. Use that caller key for authenticated first-party private API calls; generated public reads carry no key. Reuse the existing API-key CLI, random-key generation, `auth.api_keys` hash store and revocation; no duplicate login/key system is built.
- **Credential boundary.** Use this system's revocable, named administrative API credentials, explicitly provisioned for this first-party gateway. The API remains the key-verification authority; refuse the MCP connection before discovery and recheck authorization for every operation. Document the private authentication-check operation needed for discovery, without exposing key hashes or creating a second key store.
- This private API-key mechanism is not an OAuth proxy. Do not accept arbitrary third-party access tokens or forward OAuth tokens between different resource audiences; any future OAuth integration needs its own reviewed audience/token-exchange design. Confirm SDK/specification compatibility before implementation.
- No raw key in model context, tool arguments/results, URLs, logs, traces or audit payloads. Credentials stay in the request authentication layer and are forwarded only to the configured first-party API, never to caller-selected hosts or across redirects. The process necessarily handles credentials in memory: compromising it can expose active credentials. There is no claim that holding no persistent key makes compromise harmless.
- **Refused at the door.** A request without a valid key is rejected before it reaches the tools; the list of tools is not disclosed.
- **Narrow tools.** No SQL, shell, filesystem browsing, arbitrary URL fetching, caller-selected API paths or database administration. General tools use a fixed entity-to-operation registry, with the same strict schemas as the API. Reject unknown entities, properties, operators and attempts to mutate IDs or protected relationships. Use parameterized persistence queries.
- **Database boundary.** The MCP container has no database credentials, database client dependency or network access to Postgres. Only the API backend accesses persistence. The production API runtime role has only its required data privileges; migration/owner credentials stay out of the MCP and application runtime. Enforce this in deployment configuration and negative tests.
- **Deletion apart.** Deletion targets exactly one explicitly identified record; no bulk/delete-by-filter tool. Destructive annotations inform clients but are not authorization or proof of human consent. The supported owner-client setup requires approval for destructive calls; clients that cannot enforce it use the owner's explicit maintenance path instead. Test the client configuration and the API boundary, not just annotation values.
- **Transport controls:** bounded payloads, execution time and concurrency; rate limits before authentication and per authenticated caller; validate any supplied Origin against the configured allowlist and reject an invalid one. Check every MCP HTTP method, discovery path and session reuse. Network privacy, Origin and CORS never replace authentication. Missing/revoked credentials fail without tool disclosure or side effects.
- **OAuth is not part of this phase.** The initial clients run on the owner's machine or inside the server network and support the documented private authentication flow. Hosted clients without tunnel/private-network access are not supported. Revisit OAuth and resource audiences explicitly if that use case appears.

Confirm implementation against the [MCP transport requirements](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [security guidance](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices), including credential audiences and redirects; a private network does not waive those checks.

### Record of writes

- Implemented in the API, not in the MCP server, so that it covers every caller.
- Each write stores: when, which API key (by name), which route, which entity and record, and the state before and after.
- It lives in its own schema, apart from content. It is not exposed on public routes.
- A general tool reads it, so the owner can ask an agent what changed.
- Undo is not automated in this phase; the record makes a manual restore possible.

### Tools

Cover the complete content API from phases 2 and 4: profile, experiences, projects, services, explorations, education, media, roadmap, diary, books and events. No admin UI is introduced. Two layers, about a dozen tools in total. More would make selection worse and cost context.

**Task tools** — one tool per intent; each may perform several steps:

| Tool                    | Does                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Log a study session     | Finds or creates the day's diary entry, finds the resource (or event), stores the time record and the notes |
| Find a resource         | Searches resources by name or link and returns candidates                                                   |
| Add a resource          | Adds a resource to a module                                                                                 |
| Set a resource's status | Planned, in-progress, completed, paused, skipped                                                            |
| Add an event            | Creates the event                                                                                           |
| Add or update a book    | Creates a book or changes its state and summary                                                             |
| Upload a file           | Uploads an image or a PDF and returns the media record                                                      |

**General tools** — over a fixed list of entities from both domains:

| Tool               | Does                                              |
| ------------------ | ------------------------------------------------- |
| Describe an entity | Returns its fields and their rules                |
| List               | Returns the records of an entity                  |
| Get                | Returns one record                                |
| Save               | Creates or updates one record, with its relations |
| Delete             | Deletes one record. Marked destructive            |
| Recent changes     | Reads the record of writes                        |

- Tool descriptions state when to use the tool and when to use another one instead.
- Errors from the API are returned in a form the agent can act on: the field, the reason.
- A task tool that finds more than one candidate returns the candidates instead of choosing.

- Natural "started" maps to the phase-4 `in-progress` contract value; book status is derived from dates, not a separate writable status field.

### Skills

Kept in the repository, written for any agent connected to the server:

| Skill            | Job                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `diary-entry`    | Log a study session from partial input; replaces the owner's current skill, which writes to the old database |
| `add-event`      | Record an attended event and the time spent                                                                  |
| `update-profile` | Change part of the profile: look first, show the change, then save                                           |
| `update-cv`      | After a change that affects the CV, check the CV page and remind the owner to upload a new PDF               |

A skill describes the conversation — what to ask when information is missing, what to confirm — and leaves the mechanics to the tools.

### Evals

- **Runner:** promptfoo, with red-teaming support; one eval tool for the whole repository. A case's task and its check of the resulting data are custom code plugged into it. Its current capabilities are checked against its documentation at the start of the phase.
- **What a case is:** an instruction as the owner would phrase it, a starting state of the data, and the expected state afterwards.
- **The task:** an agent with the model and this MCP server, connected to a test API with its own database, carries out the instruction.
- **Scoring is deterministic wherever possible:** the resulting state of the database and the tools that were called — not the wording of the reply.
- **About thirty cases to start**, in Czech and English, covering:
  - choosing the right tool for an intent;
  - filling the arguments correctly (dates such as "yesterday", time ranges, statuses);
  - asking instead of guessing when two resources match or information is missing;
  - not deleting without an explicit instruction, including when the instruction is suggestive ("clean up the old entries");
  - looking before changing: an update does not overwrite fields that were not mentioned;
  - handling a validation error by correcting the call;
  - using a task tool rather than several general ones.
- **Thresholds:** safety cases (no unrequested deletion, no overwrite of unmentioned fields) must all pass. The remaining cases have an overall threshold set when the first baseline is measured, and it is never lowered to make a run pass.
- **When they run:** on demand, and for changes that touch this app. Not on every pull request: they call a real model, cost money and need a model key in CI.
- **The list of cases is approved by the owner** before implementation starts.
- How the agent in the task is driven (which SDK), and the model used, are chosen at the start of the phase against current documentation.

### Other

- The app gets a Dockerfile, an internal-only Compose service and its own `AGENTS.md`.
- Knowledge-document ingest is a terminal workflow in phase 9, not part of this phase's general content tools. Do not expose knowledge staging, raw originals, credentials, audit storage or conversation tables as generic content entities.
- `docs/testing.md` is extended with how evals are written and run here; later phases follow it.

## Testing Decisions

- **Evals first** for behaviour that depends on the model: tool selection, arguments, asking, restraint. Described above.
- **Test-first, without a model,** for everything deterministic:
  - each tool against a test API — given this input, these API calls and this result;
  - a request without a key or with a revoked key is refused and discloses no tools;
  - the key is passed on unchanged and never stored or logged;
  - validation errors are translated into the agreed form;
  - the record of writes — every content-write route produces an entry with before and after; the walking test from phase 2 is extended so a new route cannot be left unrecorded;
  - unknown entities/fields, SQL injection, path traversal, arbitrary-host/redirect credential exfiltration and oversized inputs are refused without side effects;
  - all MCP methods authenticate, revocation applies to existing connections on their next operation, and credentials never enter captured outputs/logs;
  - public edge access cannot reach either MCP Admin or private content-write routes, even with a valid key; the documented internal/tunnel path works;
  - deployment grants MCP no Postgres access and keeps migration credentials out of the API runtime.
- Security regressions are ordinary deterministic CI tests. Real-model restraint evals supplement these boundaries; they cannot replace them.
- **Skills** are checked by running each once end to end against the demo data; this is a HITL step.
- **Prior art:** the owner's EveBit MCP server; the API tests of phase 2.

## Out of Scope

- OAuth and connecting from the claude.ai apps.
- Automated undo.
- Bulk operations and imports through MCP; the seed command covers those.
- Any read tool for the public — the agent is phase 6, the AI service phase 7 and public MCP phase 8.
- RAG ingest, knowledge graph, ontology and external MCP UI.
- A private flag on any content.
- Running evals on every pull request.

## Further Notes

- **HITL issues:** approval of the eval case list; a trial of each skill by the owner.
- The owner's global `diary-entry` skill keeps working against the old application until launch; the new one is used against the new system from this phase on, for testing, and becomes the only one at launch.
- An API key for evals in CI is a model provider key, a different thing from this system's API keys. It is stored as a repository secret and used only by the on-demand eval workflow.

## Approved phase-5 planning artifacts

- [Published issue breakdown](issues.md): five approved vertical slices with GitHub links and dependencies.
- [Security acceptance scenarios](security.md): 24 deterministic families, including API-owned atomic audit and safe handling of uncertain writes.
- [Model eval catalogue](evals.md): 32 fictional Czech/English cases with observable state/trace expectations and proposed gates.

The owner approved publication of the five-issue breakdown and its case catalogue in conversation on 2026-11-18. These are planning specifications, not a claim that implementation or live evaluations have started. The actual supported-client/baseline gate remains part of implementation. The current best-effort post-write notification is retained for invalidation, not reused as authoritative transactional audit.
