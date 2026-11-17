# Phase 11 — Knowledge graph

|            |                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Status     | Draft, revised after the owner's architecture discussion; awaiting document approval                                        |
| Date       | 2026-11-17                                                                                                                  |
| Parent     | `.plan/00-overview/prd.md`                                                                                                  |
| Depends on | Phases 9 and 10                                                                                                             |
| Result     | After launch, evidence-backed relationships extend the existing knowledge base and retrieval without changing API authority |

## Problem Statement

RAG can find passages but does not explicitly represent how Petr's roles, projects, technologies and learning connect. A small knowledge graph should answer relationship questions and demonstrate its measured value over the launched RAG baseline.

## Solution

Build concrete entities and relationships from current structured API data and approved supplemental evidence. Start with a small explicit schema; automatic ontology construction remains phase 12. This phase is not a launch prerequisite.

## User Stories

1. A visitor asks which projects demonstrate a technology or how learning connects to work and receives a source-backed path.
2. The owner can inspect proposed extra-document relationships and correct unsupported links.
3. A reviewer can compare graph-assisted retrieval with ordinary RAG and inspect provenance for every edge.

## Implementation Decisions

- Reuse the existing knowledge/index boundary and same PostgreSQL initially; choose node/edge storage details at phase start. A graph database, new app or worker needs demonstrated necessity and an explicit architecture decision, not this PRD's mere mention of a graph.
- Initial schema covers person, experience, project, exploration, technology, service and learning evidence, with named typed relationships. Do not call automatic ontology generation a prerequisite.
- API identifiers/facts remain authoritative. Preserve built/tested/designed status and dates. Extra documents may supply evidenced context but cannot upgrade a competence or overwrite an API fact.
- Every node/edge carries source/version and distinguishes directly structured, extracted and inferred information. Model extraction is an untrusted proposal; it needs validation and owner review before public publication. An inferred path is never presented as a directly evidenced fact.
- Only approved current sources participate. Replacement, withdrawal and deletion invalidate their derived edges and caches; do not allow an orphaned edge to preserve retracted information. Rebuild from API data and retained approved originals.
- API backend owns persistence; Python uses bounded HTTP capability contracts. Read tools expose controlled relationship queries, not arbitrary SQL/Cypher or graph traversal chosen by a visitor.
- Add graph-assisted retrieval only to the existing agent/MCP read interfaces. No public write tool, extra generation endpoint or new agent is introduced.
- Bound graph depth, fan-out, result count, latency, extraction tokens and spend. Credentials and source originals remain private.

## Testing Decisions

- Evals first: fictional relationship questions, expected paths/sources, unknown relations, contradictions, skill-status inflation and injected source instructions. Freeze safety/quality gates before implementation.
- Compare structured tools + RAG against the same system with graph evidence; report quality, source accuracy, latency and cost. Publish negative findings rather than hiding overhead.
- Test stable identity, deduplication, provenance, authority, retraction/rebuild and bounded traversal with real Postgres fixtures and fake extraction.
- Negative tests preserve all public read-only and private source boundaries. No migration/graph change bypasses the API or breaks the prior release's forward-compatible deployment policy.

## Out of Scope

- Automatic ontology induction/certification (12), external MCP UI (13), cross-visitor memory, external data sources or a general enterprise graph platform.

## Further Notes

- Graph capability is requested as a separate demonstration phase. Evals select its useful production scope; a disappointing result is documented, not an excuse to add an unexplained graph dependency.
