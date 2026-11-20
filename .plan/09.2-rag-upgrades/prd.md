# Phase 9.2 — RAG upgrades: BM25 and parent-child retrieval

|            |                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Status     | Outline from the owner's phase-9 interview (2026-11-20); to be completed and approved after phase 9.1 is merged    |
| Date       | 2026-11-20                                                                                                         |
| Parent     | `.plan/00-overview/prd.md`                                                                                         |
| Depends on | Phases 9 and 9.1 (the agent's evidence token budget is needed to measure larger context). Does not block phase 10  |
| Result     | Measured improvements to lexical ranking and to the context passed to the agent, kept only where evals show a gain |

## Problem Statement

Phase 9 ships Postgres full-text ranking, which is not BM25, and returns single chunks. Answers to broader questions may lose context, and lexical ranking may limit exact-name questions. Both are deliberate simplifications of phase 9, prepared for in its data model.

## Scope (to be detailed)

1. **BM25 lexical ranking inside Postgres.** Replace or complement `ts_rank` with a BM25 ranking from a Postgres extension compatible with the pgvector image (candidate chosen and its ARM64 build, licence and maintenance verified during this phase). No separate search engine. Czech handling (no built-in stemmer) is part of the comparison.
2. **Parent-child retrieval.** Search small chunks, return their parent section (stored by phase 9 with heading path and text span) to the caller, deduplicating chunks that share a parent.
3. **Neighbour expansion.** Return adjacent chunks (by the ordinal stored in phase 9) around a relevant chunk, as an alternative to whole parents.
4. **Evals.** The phase-9 question set and graded relevance plus the phase-9.1 grounded-answer evals, measured against the agent's evidence token budget. Thresholds from phases 9 and 9.1 stay frozen; a variant is deployed only if it improves them without breaking the budget.

## Out of Scope

New sources or formats (OCR, images), the knowledge graph (11) and ontology (12).
