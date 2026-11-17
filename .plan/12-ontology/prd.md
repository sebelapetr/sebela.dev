# Phase 12 — Ontology and semantic validation

|            |                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status     | Draft, revised after the owner's architecture discussion; awaiting document approval                                                       |
| Date       | 2026-11-17                                                                                                                                 |
| Parent     | `.plan/00-overview/prd.md`                                                                                                                 |
| Depends on | Phase 11 (after the phase-10 launch)                                                                                                       |
| Result     | A versioned vocabulary and relation rules govern the knowledge graph; a bounded NVIDIA Auto Ontology experiment determines whether it fits |

## Problem Statement

The graph has concrete entities and edges, but their meaning and allowed relationships need a versioned definition. The owner also wants to evaluate automated ontology tooling without turning a portfolio chatbot into a separate enterprise data platform.

## Solution

Extend the graph's minimal initial schema into a reviewed ontology: terms, meanings, relationships, constraints and source mappings. Evaluate NVIDIA Auto Ontology separately before committing to its runtime or deployment stack.

## User Stories

1. A reviewer can understand exactly what a graph relation means and which facts support it.
2. The owner can review proposed terms/relations before they change public answers.
3. A developer can detect invalid or contradictory graph assertions against a versioned semantic definition.
4. The repository records what automated ontology tooling improves, what it does not and why a particular integration was selected.

## Implementation Decisions

- Start from the phase-11 schema, canonical domain glossary and API concepts. Ontology describes meaning and permitted relations; it is distinct from the graph's concrete assertions and from chunk retrieval.
- Version terms, relation definitions, constraints, mappings and certification/review state. A proposed vocabulary does not automatically rewrite approved facts or publish new claims.
- Keep API precedence and complete provenance. Re-validate affected assertions after an ontology change and support a documented rebuild/migration; reject incompatible mappings instead of silently changing meanings.
- NVIDIA Auto Ontology is a candidate, not an approved full-platform dependency. Current upstream documentation emphasizes relational metadata, semantic mappings and SQL-oriented reasoning; do not assume it is a PDF/document RAG parser.
- First run a time- and cost-bounded experiment using fictional API exports/snapshots in isolation. Compare it with the existing small explicit schema on concrete semantic questions, consistency and maintainer effort.
- Preserve the API/database boundary. No Python app/package or public tool receives production database credentials, arbitrary generated SQL execution or direct source-storage access. If the tool requires those privileges, select a bounded export-based integration or bring a concrete revised architecture to the owner; do not silently override the boundary.
- Prefer a reviewed artifact/library integration over importing its entire UI, ingestion service, authentication stack or MCP server. Concrete components and infrastructure are selected only from experiment evidence and owner review.
- Expose useful semantic reads through the existing bounded capabilities; no new public/admin surface is assumed. Keep automatic proposals separate from certified public definitions.

## Testing Decisions

- Evals first: expected concept meanings, mappings, allowed/disallowed relationships, ambiguous terms, API conflicts and provenance.
- Deterministic tests cover versioning, constraints, validation of assertions, migration/rebuild and rejection of uncertified definitions.
- Compare RAG, RAG + graph and RAG + graph + ontology with the same fictional question set. Record quality, latency, extraction/maintenance cost and complexity.
- Test that tool-generated SQL, suggested connectors and automatic discovery cannot bypass the existing read contracts or reach private data.

## Out of Scope

- A general semantic platform, autonomous certification, importing confidential client systems, unrestricted text-to-SQL or a replacement application/authentication stack.
- External MCP interactive UI (13), required GPU infrastructure or adopting Cognee/Temporal by default.

## Further Notes

- Verify current capabilities, license and deployment requirements at experiment time: [NVIDIA Auto Ontology](https://github.com/NVIDIA/auto-ontology).
- This phase ships after launch; the first-release chatbot keeps working if the experiment finds no suitable production integration.
