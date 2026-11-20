# Phase 9 — RAG knowledge base: ingest, embeddings and retrieval

|             |                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status      | Draft from the owner's phase-9 interview (2026-11-20); awaiting document approval                                                                                        |
| Date        | 2026-11-20                                                                                                                                                               |
| Parent      | `.plan/00-overview/prd.md`                                                                                                                                               |
| Depends on  | Phases 2 and 4 (content API, storage drivers, the write attachment point). **Not** on phases 6, 7 or 8                                                                   |
| Followed by | Phase 9.1 (`.plan/09.1-rag-integration/prd.md`): public search, budget admission, agent tool and skill, public MCP search and the Sources contract                       |
| Result      | A private, measured knowledge base in the existing PostgreSQL: portfolio content and owner-approved extra documents, private originals and an authenticated search route |

## Problem Statement

Structured tools answer exact questions, but open questions need relevant passages from portfolio content and from additional explanations the owner supplies. Those extra documents must not become pages or public downloads, and unreviewed or sensitive material must not reach an embedding provider or the knowledge base.

The owner also wants this work to run in a second phase loop while phase 7 (AI service) and phase 8 (public MCP) are built. Phase 9 therefore delivers the knowledge base and its retrieval interface on its own, without the Python agent, the chat runtime, the phase-7 spend ledger or public exposure. Connecting it to chat and MCP is phase 9.1.

## Solution

Delivered in order: retrieval evals -> private originals -> ingest, extraction and chunking -> sensitivity checks and owner approval -> embeddings and index -> portfolio indexing -> retrieval variants -> authenticated search route.

```text
owner terminal -> api maintenance CLI -> packages/services -> packages/memory (ingest/index/search orchestration)
                                                         -> packages/db (retrieval schema, pgvector)
                                                         -> private storage (local | bunny-s3 private zone)
API content write -> onWrite attachment point -> persisted indexing work -> packages/memory
API-key caller (owner, evals) -> private search route -> packages/memory -> packages/db
```

Everything is TypeScript inside the API backend. `packages/memory` is the knowledge/retrieval layer, called only by the API backend; persistence stays behind `packages/db` operations. Python, the website and both MCP apps are untouched in this phase.

Inside `packages/memory`, ingest and retrieval are separate modules joined only by the stored chunk contract (text, vector, source, version, hashes): `ingest` (load, extract, clean, sensitivity and conflict checks, chunking, version and approval state), `indexing` (persisted work queue, batched embedding, spend ceiling, rebuild), `retrieval` (query embedding, vector and full-text candidates, rank fusion, reranking, relevance floor, passage projection) and `providers` (embedder and reranker interfaces with Voyage and deterministic fake implementations). The package exposes two narrow operation sets: ingest/index for the CLI and the write hook, and search for the route. No RAG framework (LangChain, LlamaIndex): Drizzle's pgvector support, a PDF text extractor, a Markdown parser and a tokenizer cover the narrow parts; chunking, fusion and thresholds are the repository's own code.

The private search route returns exactly the passage projection phase 9.1 will expose to the agent tool and public MCP. Phase 9.1 adds the public path and budget admission; it must not need to redesign the result shape.

## User Stories

1. As the owner, I want to ingest a Markdown, plain-text or text-layer PDF file from a terminal, so that I can add explanations that are not part of my structured portfolio.
2. As the owner, I want unsupported, malformed, password-protected, scanned or empty files rejected with an actionable message, so that I know what to fix.
3. As the owner, I want to see the extracted text, the chunks and the sensitivity findings before anything is published, so that I decide on exactly what will become public knowledge.
4. As the owner, I want a version with sensitivity findings blocked until I supply a sanitized revision, so that a secret or private identifier cannot slip into the index.
5. As the owner, I want to approve one exact version, identified by its content hash, so that a later change to the file needs a new approval.
6. As the owner, I want ingesting the same version twice to do nothing new, so that repeated commands are safe.
7. As the owner, I want to replace a source with a new approved version atomically, so that search never shows a mix of old and new chunks.
8. As the owner, I want to withdraw a source and have it disappear from search immediately, independent of the embedding provider, so that a mistake can be undone at once.
9. As the owner, I want to delete a source, its original and its chunks, so that nothing of it remains.
10. As the owner, I want to list sources with their status, version, approval and indexing state, so that I can see what the knowledge base contains.
11. As the owner, I want to rebuild the whole index from current API data and retained approved originals, so that a model change or a lost index is recoverable without re-approving everything.
12. As the owner, I want a rebuild never to publish a source I rejected or withdrew, so that rebuilding is safe.
13. As the owner, I want originals kept in private storage with no public URL, so that approved information can be public while the files themselves are not downloadable.
14. As the owner, I want portfolio content indexed automatically after I edit it through the API or admin MCP, so that I do not approve every ordinary content change.
15. As the owner, I want saving content to succeed even when the embedding provider is down, so that indexing problems never block editing.
16. As the owner, I want stale evidence for deleted or replaced portfolio records excluded while re-indexing catches up, so that search never cites removed facts.
17. As the owner, I want unfinished indexing work retried after a restart, so that an interrupted process loses nothing.
18. As the owner, I want unchanged approved content never re-embedded, so that I do not pay twice.
19. As the owner, I want embedding spend recorded and capped by configuration, so that indexing cannot run up an unexpected bill.
20. As the owner or an eval run, I want an authenticated search route that returns ranked passages with source identity, version, provenance and a canonical page link where one exists, so that I can test retrieval before it is public.
21. As the owner, I want search to return no evidence below a calibrated relevance floor, so that weak matches are not presented as answers.
22. As the owner, I want search filtered by content kind, so that a caller can ask only roadmap or only profile knowledge.
23. As the owner, I want supplemental sources to carry a safe display label and identifier but never a fabricated URL or storage link, so that private files stay private.
24. As the owner, I want known conflicts between an extra document and a structured API fact flagged and the conflicting claim excluded until I resolve it, so that API facts keep precedence.
25. As a reviewer, I want measured recall, reciprocal rank and correct empty results for full-text, vector, hybrid and reranked retrieval on a fictional EN/CS question set, so that the deployed variant is chosen by evidence.
26. As a reviewer, I want thresholds frozen in the repository before the hybrid and reranking work starts, so that nobody lowers them to pass.
27. As a visitor or an external agent, I want no access at all to the knowledge base in this phase, so that unfinished retrieval cannot be abused or charged to the owner.

## Implementation Decisions

### Independence from phases 6, 7 and 8

- Phase 9 starts from current `master` and runs in its own loop alongside phase 7. It touches no Python, no `chat` schema, no chat event or Sources contract, no website code and no MCP app.
- It adds its own `retrieval` modules to `packages/db`, `packages/services`, `packages/contracts` and `apps/api`, and creates `packages/memory`. Shared documents are edited only in their retrieval/knowledge sections.
- Drizzle migrations are generated normally per issue. The phase pull request into `master` waits until phases 7 and 8 are merged; the phase then merges `master` in, regenerates its unmerged migrations on top of the new numbering and resolves document conflicts once.

### Sources and authority

- Only the owner's portfolio and owner-supplied extra documents. Portfolio content is read from its API/database representation, not by crawling the rendered website. No external websites, GitHub/LinkedIn crawling or live web search.
- Portfolio scope: public profile, experiences, projects, case studies, services, education, roadmap, diary, books, events, resources, FAQ and glossary, as the approved question set requires.
- Structured API data is authoritative for facts such as dates, roles, project status and technologies. Supplemental documents explain and enrich; they never silently overwrite.
- Deterministic checks compare supplemental claims with structured facts where possible (dates, role titles, technology names); a found conflict is recorded, the conflicting chunk is excluded from search until the owner resolves it, and the CLI shows it. Prose conflicts beyond that are left to evals and review; complete automatic conflict detection is not claimed.
- Approved extra material may appear in public answers and search later; private original-file access does not make its approved information confidential.

### Ingest from a terminal

- A backend maintenance CLI in the API, like the existing seed CLI, reusing services, storage and validation. No new app, admin UI or MCP ingest tool. Commands cover: ingest a file, show a version (extracted text, chunks, findings, conflicts), approve a version by hash, reject, withdraw, delete, list, re-index pending work and rebuild.
- Formats: UTF-8 Markdown, plain text and PDF with an extractable text layer. PDF is a separate, last ingest issue, so a parser problem does not block the rest.
- Limit file size, extracted text size, processing time and parser resources; check the actual content type; generate storage keys; resist path traversal. Parse documents as data; never execute embedded content or follow links.
- Lifecycle: stage privately -> extract and normalize -> local sensitivity checks -> owner preview -> explicit approval of this exact content hash -> embed and index. No pending, rejected or withdrawn version reaches the embedding provider or search.
- Local sensitivity checks detect common credentials and secrets (key formats, tokens, private keys, connection strings) and sensitive identifiers (e-mail addresses, telephone numbers, national identifiers, bank account numbers) before any external call. A version with findings is blocked until a sanitized revision is ingested. Finding metadata is stored without copying the detected value into logs or the database. No claim of perfect detection; human review covers context-specific confidentiality.
- Changing bytes after approval invalidates the approval. Repeated ingestion of the same version is idempotent. Incomplete extraction is rejected, never indexed truncated.
- Portfolio records are already public and are indexed automatically without per-edit approval.

### Originals and private storage

- Extend the existing storage interface with private store, read and delete operations that never produce a public URL. Driver selection stays explicit configuration; a provider failure reports failure, never falls back to a different store.
- `bunny-s3`: a separate private Storage Zone with its own credentials and no Pull Zone/CDN mapping, distinct from public media. A `private/` folder in public media is not access control. Preserve development/production separation and worktree prefixes.
- `local`: a separately configured private root outside the API's public static directory and outside Git, never served by the public media handler.
- Storage credentials and original reads belong to the backend and maintenance path only.
- Retain source identity, version hash, safe display title, provenance, approval state and storage key. Original filenames and paths are not automatically public titles. Approval/source metadata and originals are backed up; the index is rebuildable derived data.
- Existing public media upload validation stays separate; knowledge files do not broaden the public image/CV serving surface.

### Chunks, embeddings and the retrieval schema

- A separate `retrieval` schema in the existing PostgreSQL with its pgvector extension. No second vector database or Redis.
- Chunks hold retrievable text, the vector, heading context, source/version references and hashes. Long documents split by headings before size/overlap boundaries; portfolio records chunk by record and section. Parameters are tuned with evals.
- Embeddings: **Voyage AI, `voyage-4`** as the initial model, behind a replaceable embedder interface (decision 0010). The builder verifies the current model name, dimension, price and free-tier terms in Voyage's documentation before the first paid call. `voyage-4-lite` or another provider is compared only if `voyage-4` misses a frozen threshold or a latency target. Store model, version, dimension and content hashes per chunk; changing the model requires a controlled rebuild.
- The key is `VOYAGE_API_KEY` in the main checkout's `.env.secrets`, placeholder in `.env.secrets.example`, used through `harness/with-secrets.mjs` for evals and through the API's environment in deployment. Ordinary tests use a deterministic fake embedder.
- Embedding spend in this phase: every provider call records reported token usage and estimated cost in private retrieval state. A configured monthly embedding token/cost ceiling is checked before each batch; exhaustion stops indexing with a typed error and leaves work pending. Batch sizes, retries and timeouts are bounded. Phase 9.1 folds this category into the overall AI ceiling of phase 7's ledger.
- Ingest, approval and indexing state is private maintenance data. There is no generic list/CRUD route over ingest records or raw retrieval tables.

### Incremental indexing and withdrawal

- After an API content write commits, schedule indexing of the affected records through the existing `onWrite` attachment point that website invalidation uses. Pending and failed work is persisted so an interrupted process retries; no separate worker at this volume.
- A content write never fails because the embedding provider is unavailable. Evidence for deleted or superseded records is excluded immediately; re-indexing and rebuild recover the rest.
- Replacing an extra document publishes a complete approved version atomically; a failed replacement exposes no partial or pending chunks. Withdrawal removes the source from search immediately.
- Replacement and deletion remove old chunks and version references. Rebuild uses current API data and retained approved originals and preserves approval; it cannot publish a rejected or withdrawn source.

### Retrieval and the private search route

- Two-stage retrieval. Stage 1: vector candidates by cosine distance (pgvector, HNSW index) and full-text candidates (Postgres full-text with the `simple` configuration and `unaccent`, since Postgres has no Czech stemmer), merged by reciprocal rank fusion into a configurable candidate pool (initially 30). Stage 2: a cross-encoder reranker (Voyage's current reranker, verified in its documentation) scores query and passage together and selects the final passages (initially 5–8); the relevance floor applies to the reranker score. The reranker is the expected configuration, but evals compare full-text only, vector only, hybrid without reranking and hybrid with reranking; if reranking brings no measurable gain it is switched off by configuration. Pool size, final count and floor are configuration tuned by evals.
- `packages/memory` exposes one search operation: query text, optional content-kind filter and result limit in; ranked passages out, or a typed result for no evidence, budget exhausted or provider unavailable. "No evidence" is never used for a failure.
- The route is private: the existing API-key authentication, per-key rate budget and request validation apply. It is not reachable anonymously and is not advertised to the website or MCP.
- Bound query length, result count, result text length and latency. Below the calibrated relevance floor, return no evidence.
- Each passage carries: passage text, source ID, source kind (`portfolio` or `supplemental`), safe display title, version, provenance, score, and for portfolio sources a canonical site path/anchor validated against known routes. Supplemental sources carry a label and identifier, never a URL or storage link. This shape is defined in a new `retrieval` module of `@sebela/contracts` and is what phase 9.1 exposes publicly.
- Retrieved text is data; instructions inside documents are never executed. Treating them safely in the agent is phase 9.1's job, but the eval set already contains an injected-instruction document.

### Evals and measurement

- Evals first, run by promptfoo from `packages/memory/evals/`, the repository's shared runner. A fictional question set of about forty EN/CS questions over the demo seed plus fictional extra documents (including one contradicting an API fact and one with injected instructions), with expected sources and no-answer cases. Cover exact names, paraphrases, cross-record questions, roadmap and diary, extra sources and conflicts.
- Metrics: recall at k, mean reciprocal rank, correct empty results, provenance accuracy, latency and embedding cost per query. No LLM judge in this phase; answer groundedness belongs to 9.1.
- No owner stop in the loop: the agent drafts the question set, measures full-text and vector baselines, proposes thresholds and commits them in an issue that precedes hybrid and reranking work. Thresholds are never lowered afterwards (hard rule 9); the reviewer checks this. The owner reviews the set, method and thresholds in the phase pull request.
- Paid eval spend for the whole phase is capped at **USD 3**, separate from the USD 10 campaign of phases 6 and 7; a single run stops at USD 1. Saved-result regrading and the secret wrapper follow the existing eval rules. Paid evals run per issue only for affected cases, and completely at the phase pull request into `master`.
- Publish the fictional datasets, method and results. Real owner documents never enter Git.

## Testing Decisions

- Tests check external behaviour through module interfaces (`packages/memory` search and ingest operations, the CLI, the HTTP route), not internals. Prior art: the services/db integration tests on a temporary database, the storage contract tests for both drivers, the API route tests with API keys, and the MCP Admin eval runner.
- Test-first: extraction, type/size/parser limits, sensitivity findings, approval bound to an exact hash, rejection, withdrawal, deletion, idempotent ingest and no external embedding call before approval.
- Real Postgres/pgvector with the fake embedder: unchanged hashes skip embedding, complete replacement, model-version rebuild, content-kind filter, rank fusion, relevance floor, deletion and restart recovery of pending work.
- Spend: ceiling exhaustion stops indexing with a typed error and keeps work pending; usage is recorded once per call; bounded retries.
- Private storage contract tests for both drivers: no download through media, API or CDN paths, generated keys, traversal resistance and failure cleanup. Optional live Bunny checks need dedicated development keys; CI uses local storage only.
- Route tests: no API key -> refused; oversized query -> refused; passage shape validated against the contract; supplemental passages never carry a URL; pending, rejected and withdrawn content never returned.
- Content writes succeed with the embedder failing; stale evidence for a deleted record is excluded at once.

## Out of Scope

- Anything public: a public or anonymous search route, retrieval budget admission against phase 7's ledger, the agent tool and skill, public MCP search, the Sources/event contract change and the website Sources renderer. All are phase 9.1.
- Answer groundedness and citation evals with a model. Phase 9.1.
- External sources/crawling, live web search, OCR, Word, images, a document-admin UI, ingest through MCP, an admin MCP search tool.
- Knowledge graph (11), ontology (12), external MCP UI (13), conversation memory.
- A separate vector database, Cognee, a worker or a distributed ingestion platform.

## Further Notes

- Owner acceptance at the phase pull request: question set, thresholds and measured results; a private Bunny Storage Zone created and the live `bunny-s3` private checks run with development keys; a sample real document ingested locally, approved and found by the search route.
- `packages/memory` names the knowledge/retrieval layer about Petr; visitor conversations stay in phase 7's `chat` schema.
- Sensitivity and conflict checks are finite controls, not guarantees.
