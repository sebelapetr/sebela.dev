# Phase 6 — Retrieval

| | |
|---|---|
| Status | Draft, awaiting approval |
| Date | 2026-11-15 |
| Parent | `.plan/00-overview/prd.md` |
| Depends on | Phases 2 and 4 |
| Result | The project's own retrieval over public content: an index kept in step with the database, a search that returns passages with their sources, and published measurements of how well it works |

## Problem Statement

The chatbot of phase 7 has to answer two kinds of questions. Exact ones — where did he work in 2022 — are served by reading structured data. Open ones — how does his backend experience connect to his AI work, what did he learn about retrieval — need the relevant passages from across case studies, diary notes, book summaries and event takeaways, and need to say where each came from.

There is no way yet to find those passages. And because the public content is small, it is not obvious that retrieval beats simply reading structured data — so it must be measured, not assumed.

## Solution

A retrieval layer written in this repository, with no separate vector database and no knowledge-graph service:

- public content is turned into documents, split into chunks and embedded;
- chunks are stored with pgvector in the same Postgres as their source;
- search combines vector similarity and full-text search and returns passages with links to their place on the site;
- the index follows writes automatically and can be rebuilt from the database at any time;
- the design is chosen by evals: a set of questions with known sources compares the variants, and the numbers are published.

## User Stories

### Chatbot and public MCP server (phase 7)

1. As the chatbot, I want to search public content with a question in natural language and get the most relevant passages, so that I can answer open questions from evidence.
2. As the chatbot, I want every passage to carry its source — which record, which page, which anchor — so that I can show the visitor where an answer comes from.
3. As the chatbot, I want search to work for questions phrased differently from the text, and for exact names and terms, so that both kinds of questions find their passages.
4. As the chatbot, I want to restrict a search to a kind of content (experience, roadmap, diary), so that I can look in the right place.
5. As the chatbot, I want to know when nothing relevant was found, so that I can say I do not know instead of answering from weak matches.
6. As an AI agent using the public MCP server, I want the same search available as a tool.

### Owner

7. As the owner, I want new and changed content to be searchable shortly after I save it, without doing anything.
8. As the owner, I want deleted content to disappear from search.
9. As the owner, I want one command that rebuilds the whole index from the database, so that the index is never something I have to protect.
10. As the owner, I want embedding costs to stay negligible, so that editing content never costs noticeably.
11. As the owner, I want to see measured results of the retrieval variants, so that the design is justified and I can publish it.

### Development

12. As a developer agent, I want the question set and its expected sources to exist before I build, so that I know what good retrieval means here.
13. As a developer agent, I want tests to run without calling an embeddings API, so that they are fast, free and repeatable.
14. As a reviewer, I want a change to chunking or search to show its effect on the measurements, so that "better" is a number.
15. As a technical evaluator reading the repository, I want to see how retrieval was designed and measured, so that I can judge the engineering.

## Implementation Decisions

### Modules

| Module | Interface | Hides |
|---|---|---|
| Document builder | Given a record, produce its documents | Which fields of which entity become searchable text, and the source link for each |
| Chunker | Given a document, produce chunks | How text is split |
| Embedder | Given texts, produce vectors | The provider, batching, retries |
| Index | Add, replace and remove the chunks of a record; rebuild everything | Storage, content hashes, what is skipped |
| Search | Given a question and optional filters, return ranked passages with sources | Vector search, full-text search, how the two rankings are combined, reranking |

The whole layer is one package with three operations visible outside it: index a record, remove a record, search. The API is its only caller.

### What is indexed

Public content from both domains: experiences, projects, case studies, explorations, services, the person's bio; diary entries, book summaries, event takeaways, resources and their modules and areas, the FAQ and the glossary.

Everything in the database is public, so there is no filtering by visibility. If a private flag is ever introduced, excluding such records here is part of that change.

### Documents and chunks

- One record gives one or more documents; a long markdown text is split by its headings first.
- A chunk keeps: its text, a short context line (what record it belongs to), the source reference (entity, record, the address and anchor on the site), and a hash of its content.
- Chunk size and overlap are parameters chosen by the evals, not guessed.

### Storage

- A separate Postgres schema for retrieval. One table of chunks with the vector, a full-text index, the source reference and the content hash.
- pgvector, in the same database. The Postgres image carries the extension from phase 1.
- The index is derived data: it is never backed up as a source and can be dropped and rebuilt.

### Embeddings

- A hosted embeddings API behind the embedder interface. Provider and model are chosen at the start of the phase from current documentation and confirmed by the evals.
- A chunk is embedded only when its content hash changes.
- The model's name and dimension are stored with the index; changing the model means a rebuild, and the rebuild command handles it.
- Tests use a deterministic fake embedder. Only the evals call the real API.

### Keeping the index in step

- After a successful write, the API tells the retrieval layer which record changed, through the same attachment point the website's cache invalidation uses. The record's chunks are replaced; a deleted record's chunks are removed.
- Indexing runs after the write has been answered and does not make saving slower or able to fail because of the embeddings API.
- A record whose indexing failed is marked and picked up on the next attempt; the rebuild command also repairs it.
- **No worker.** At this volume indexing is done in the API process. A worker is added only if measurements show that this is not enough.

### Search

- **Hybrid:** vector similarity and full-text search run over the same chunks; their rankings are combined into one.
- **Optional reranking** of the top results, kept only if the evals show it pays for its cost and latency.
- Filters by kind of content.
- A relevance floor: below it the search returns nothing, so the caller can say it does not know.
- Returned to the caller: the passage, its score, and the source with the address and anchor.
- Exposed as a public, read-only, rate-limited API route, so that the assistant — its chat agent and its public MCP server — uses it like any other client.

### Evals

- **The question set comes first.** About forty questions a visitor could ask, each with the records that should be found. They cover: exact names and terms; paraphrases; questions that span several records; questions about the roadmap and diary; questions with no answer in the data.
- **Measured:** how many of the expected sources appear among the top results, how high the first correct one ranks, and how often a question with no answer correctly returns nothing.
- **Compared variants:** full-text only; vectors only; hybrid; hybrid with reranking; two or three chunking settings; the candidate embedding models.
- **Baseline:** no retrieval — answering from structured read tools alone. If retrieval does not beat it on open questions, that is a finding to publish, not to hide.
- **Decision rule:** the simplest variant that meets the threshold is the one deployed. The threshold is set from the first baseline and not lowered afterwards.
- **Runner:** promptfoo, as established in phase 5.
- **Published:** the question set (fictional-data version), the method and the results go into the repository's docs and README; a change to chunking or search reports its effect on the numbers in its pull request.
- **Run on demand** and for changes to this package, not on every pull request.
- The owner approves the question set.

### Other

- The package gets its own `AGENTS.md`.
- The demo seed must contain enough text — case studies, diary notes, summaries — for the evals to be meaningful; it is extended if it does not.

## Testing Decisions

- **Evals first** for retrieval quality, as above.
- **Test-first, without any external call:**
  - the document builder — given a record, these documents with these sources;
  - the chunker — splitting by headings, size and overlap, no lost text;
  - the index — unchanged content is not re-embedded; a changed record replaces its chunks; a deleted record leaves none; rebuild produces the same result as incremental indexing;
  - search — the combination of the two rankings, filters, the relevance floor;
  - keeping in step — a write through the API makes the content searchable; a failure of the embedder does not fail the write and is repaired later.
- Integration tests run against a real Postgres with pgvector and the fake embedder.
- **Prior art:** embeddings and pgvector in the owner's Booky project; the eval set-up of phase 5.

## Out of Scope

- The chatbot, question routing and answer generation (phase 7).
- Cognee, a knowledge graph, a separate vector database.
- A local embedding model.
- Conversation memory — remembering what a visitor said earlier.
- A worker, unless measurements require it.
- Indexing anything that is not public content of the site (the repository, external pages).

## Further Notes

- **HITL issues:** approval of the question set; the decision between variants once the measurements exist.
- The phase is named "retrieval and memory" in the folder name for continuity; it delivers retrieval only.
- The results are material for a case study on the site: how retrieval was designed for a small corpus and what the numbers said.
