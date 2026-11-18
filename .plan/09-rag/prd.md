# Phase 9 — RAG: ingest, embeddings and retrieval

|            |                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status     | Draft, revised after the owner's architecture discussion; awaiting document approval                                                                         |
| Date       | 2026-11-17                                                                                                                                                   |
| Parent     | `.plan/00-overview/prd.md`                                                                                                                                   |
| Depends on | Phases 2, 4, 7 and 8                                                                                                                                         |
| Result     | Chat and public MCP search the portfolio and owner-approved supplemental documents, with private originals and measured retrieval in the existing PostgreSQL |

## Problem Statement

Structured tools already answer exact questions. Open questions also need relevant passages from portfolio content and additional explanations supplied by the owner. Those extra documents must not become pages or public downloads, and unreviewed or sensitive material must not enter the public knowledge base.

## Solution

RAG is delivered in order: ingest and provenance -> text extraction/chunking -> owner approval for extra material -> embeddings/index -> retrieval -> agent/MCP integration. Retrieval is part of RAG, not a separate memory product.

Keep the existing planned TypeScript `packages/memory` boundary for retrieval/index orchestration, called only by the API backend. This package name denotes knowledge about Petr, not visitor conversation storage. Database operations belong to `packages/db` through backend operations; Python continues to use HTTP only.

## User Stories

1. Visitors and external agents find relevant evidence for open questions in the portfolio and approved supplemental material.
2. Exact structured API facts take precedence over contradictory extra documents.
3. The owner ingests a file from a terminal, reviews extracted content and sensitivity findings, and explicitly approves publication.
4. The owner can replace, withdraw or delete a source and rebuild the index from retained originals.
5. Neither a visitor nor public MCP can list pending imports or download source originals.
6. A reviewer can compare measured structured-tools-only, full-text, vector and hybrid retrieval quality.

## Implementation Decisions

### Sources and authority

- Only the owner's portfolio and owner-supplied extra documents. Read portfolio content from its API/database representation; do not crawl the rendered website as a duplicate source. No external websites, GitHub/LinkedIn crawling or live web search.
- Include public profile/experience/project/case-study/service/education content and roadmap, diary, books, events, resources, FAQ and glossary as appropriate to the approved question set.
- Structured API data is authoritative for facts such as dates, roles, project status and technologies. Supplemental documents explain or enrich facts and relationships; they never silently overwrite them.
- Flag known conflicts for owner resolution and exclude the conflicting claims until resolved. Compare structured facts where deterministic checks are available, use review/evals for prose; do not claim automated conflict detection is complete.
- Information in approved extra material is permitted in public answers and public search/MCP results. Private original-file access does not mean the approved information is confidential.

### Ingest from a terminal

- A backend maintenance CLI reuses services/storage/validation and the API-owned persistence boundary, like the existing seed CLI. No extra app, admin UI or MCP ingest tool is introduced. Python apps/package never acquire database access.
- First formats: UTF-8 Markdown, plain text and PDF with an extractable text layer. Reject unsupported, malformed, password-protected, scanned/image-only or empty PDFs with an actionable error; OCR, Word and images are later scope.
- Limit file size, extracted text size, processing time and parser resources. Check actual content/type, generated storage keys and path traversal. Parse documents as data; never execute embedded content or follow links automatically.
- Extra-document lifecycle: stage privately -> extract/normalize -> local sensitivity checks -> show owner preview/findings/conflicts -> explicit approval of this exact content/version -> embed and publish. No pending version enters public search or model context.
- Detect common credentials/secrets and sensitive identifiers locally before any external model/embedding request. Block a version with findings until the owner supplies a sanitized revision; preserve finding metadata without copying detected secrets into logs. Human review covers context-specific confidentiality that automated rules miss. No claim of perfect secret detection.
- Hosted embedding calls receive only the approved text/version. Do not send unreviewed originals to an LLM-based checker as a shortcut around the approval boundary.
- New extra-document versions require new approval; changing bytes after approval invalidates it. Repeated ingestion of the same version is idempotent. Reject incomplete extraction rather than silently indexing a truncated document.
- Portfolio API records are already public and follow automatic incremental indexing; do not require owner approval for every normal content edit.

### Originals and storage

- Extend the existing `local`/`bunny-s3` storage interface with private read/store/delete operations; do not force a public-URL operation on a private object. Driver selection is explicit configuration. An S3 failure reports failure, not silent fallback to a different store.
- `bunny-s3`: separate private Storage Zone and credentials, with no public Pull Zone/CDN mapping, distinct from public media. A folder named `private/` in publicly served media is insufficient. Preserve development/production separation and worktree prefixes.
- `local`: separate configured private root outside the API's public static-file directory and outside Git; do not serve it with the public local-media handler.
- Storage credentials and original reads belong only to the backend/maintenance path. Neither Python runtime nor MCP receives keys or a raw-file download capability.
- Retain source identity, version/hash, safe display title, provenance, approval and storage key. Original filenames/paths are not automatically public titles. Back up original documents and approval/source metadata; the index remains rebuildable derived data.
- Bunny storage/CDN separation is described in the [official storage quickstart](https://bunny.net/docs/storage/quickstart); verify provider configuration and test the public edge before publishing real files.
- Existing public media upload validation remains separate; supporting knowledge TXT/Markdown must not broaden the public image/CV serving surface.

### Chunks, embeddings and storage

- Use a separate retrieval schema in the existing PostgreSQL with its existing pgvector extension. No second vector database or Redis is required.
- Chunks contain retrievable text as well as vectors, context, source/version references and hashes. Split long documents by headings before size/overlap boundaries; tune parameters with evals.
- A hosted embedding provider behind the embedder entry; select model/dimension from current docs and measured Czech/English retrieval results. Store model/version/dimension and hash metadata; changing the model requires a controlled rebuild.
- Unchanged approved content is not re-embedded. Deterministic fake embeddings support ordinary tests; real calls are explicitly budgeted. Keep ingest/embedding spend separate from visitor-generation reservations and bound batch retries/timeouts.
- Storage/approval/indexing state is private maintenance data. Only approved passage projections are public; there is no generic public CRUD/list over ingest records or raw retrieval tables.

### Incremental updates and withdrawal

- After an API content write commits, schedule its indexing through the existing invalidation attachment point. Persist pending/failed work so an interrupted process can retry; no standalone worker is required at this volume.
- Saving content must not fail because an embedding provider is unavailable. Exclude stale evidence for deleted or superseded authoritative records while indexing catches up; retries and rebuild recover it.
- Replacing an extra document publishes a complete approved version atomically; a failed replacement does not expose partial or pending chunks. Explicit withdrawal immediately removes that source from public retrieval, independently of provider availability.
- Remove old chunks/version references on replacement or deletion. Rebuild from current API data and retained approved originals, preserving approval; it cannot publish a previously rejected source.

### Retrieval and agent/MCP integration

- Compare full-text only, vectors only, hybrid rank fusion and optional reranking. Start from the existing hybrid-search proposal and deploy the simplest variant meeting frozen eval thresholds.
- Public retrieval can incur embedding/reranking charges even though it cannot invoke chat generation. Extend the API-owned durable cost ledger with retrieval admission for every paid query, including anonymous API/MCP callers. Atomically reserve a bounded allowance for query embeddings/reranking/retries against configured daily/monthly retrieval and overall AI ceilings before provider calls; reconcile reported or conservatively uncertain usage. Separate ingest and visitor-generation categories do not bypass the overall ceiling. Rate limits alone are not a spend cap.
- When retrieval admission is exhausted or a provider fails, return a typed unavailable/budget result rather than treating failure as "no relevant evidence". No MCP generation credential is needed or granted for this limited search capability.
- Bound input/query length, results, result text, latency and request rates. Filter by content kind; below the calibrated relevance floor return no evidence.
- Return passages, source IDs, safe display titles, version/provenance and canonical URLs/anchors where a public portfolio page exists. Extra sources without public pages use a source label and identifier, never a fabricated URL or storage link.
- Extend the existing source/event contract compatibly: distinguish portfolio references with canonical page links from supplemental references with a safe label, identifier and version but no public URL. Generate clients/models from the updated contract; Output Guard accepts only source IDs from returned evidence and never invents a link for an extra document. Update the website Sources renderer to show a safe non-clickable title for supplemental evidence; keep existing portfolio links working and add fixtures/contract scenarios for both variants.
- The API exposes the bounded public search projection. Shared Python tools call it over HTTP; chat invokes them in-process and public MCP reaches them through FastAPI. Do not expose raw vectors as the agent interface or duplicate the search implementation in Python.
- Preserve structured tools for exact facts. The agent's system policy and evidence ledger apply API precedence to supplemental evidence; retrieved instructions remain untrusted data.

### Evals and measurement

- Evals-first, with an owner-approved fictional question set (about forty initial questions), expected sources and no-answer cases. Cover exact names, paraphrases, cross-record questions, roadmap/diary, extra sources, API conflicts and injected document instructions.
- Measure recall among top results, reciprocal rank, correct empty results, citation/provenance accuracy, grounded answers, latency and embedding/query cost.
- Compare structured-tools-only baseline, full-text, vectors, hybrid, reranking, chunk sizes and candidate embeddings. Freeze thresholds after baseline and before implementation; never lower them to pass.
- Publish fictional datasets, method and results. Real owner documents/visitor questions remain outside Git. Promptfoo remains the shared runner; no new eval service.

## Testing Decisions

- Test-first: extraction, type/size/parser limits, sensitivity findings, exact-version approval, rejection/withdrawal, idempotent ingest and no external call before approval.
- Test concurrent anonymous retrieval reservations, query/rerank retry accounting, exhausted overall/retrieval budgets and interrupted calls with uncertain usage. These gates cover direct API search and MCP search alike.
- Real Postgres/pgvector plus fake embeddings: unchanged hashes, complete replacement, model-version rebuild, filtering/rank fusion/relevance floor, deletion and restart recovery.
- Private storage contract tests for both drivers: no unauthenticated download through media/API/CDN paths, generated keys, private-root traversal resistance and failure cleanup. Optional live Bunny checks require dedicated development keys; CI uses local storage only.
- Test API facts winning over contradictory extra material and invalid source URLs being rejected by Output Guard.
- Integration/end-to-end parity: search from the web chatbot and public MCP returns only approved current evidence; pending/rejected/original content and credentials are inaccessible.

## Out of Scope

- External sources/crawling, live web search, OCR, Word, images, a document-admin UI or ingest through MCP.
- Knowledge graph (11), ontology/Auto Ontology (12), external MCP UI (13), conversation memory across identities.
- A separate vector database, Cognee, extra worker or distributed ingestion platform.

## Further Notes

- This completes the first-release knowledge capability. The owner-approved corpus and sensitivity/conflict checks are finite controls, not guarantees that all secrets or contradictions can be detected automatically.
- Source knowledge and visitor history are separate. `packages/memory` names the knowledge/retrieval layer; conversations stay in the API's separate schema from phase 7.
