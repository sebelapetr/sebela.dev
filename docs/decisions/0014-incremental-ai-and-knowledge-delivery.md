# 0014 — Incremental AI delivery and approved knowledge sources

Status: accepted
Date: 2026-11-17

## Decision

- Preserve the TypeScript API as the data trust boundary and the separate TypeScript Admin MCP, Python agent package, FastAPI runtime and Python Public MCP responsibilities from 0012.
- Deliver phases 05 Admin MCP -> 06 reusable agent -> 07 AI service/live structured-data chat -> 08 Public MCP -> 09 RAG -> 10 first launch. Graph (11), ontology (12) and external MCP UI (13) are separate post-launch phases.
- Admin MCP and private content-write routes are internal or reached through an authenticated SSH tunnel, with application authentication still required. Do not publish an admin subdomain or let the public API bypass the network policy.
- One conversation per anonymous browser identity, restored on `/ask`; no session picker or cross-device identity. Conversation context is separate from knowledge about Petr.
- RAG uses only portfolio content from its API and extra owner-supplied documents. API facts take precedence; extras provide context. Extra information is approved for public answers/search, while originals stay private.
- Ingest extra Markdown, TXT and text-layer PDF from a terminal. Local sensitivity checks and explicit owner approval of an exact version precede external embeddings and public indexing. Automated detection is not a guarantee of confidentiality.
- Keep the existing PostgreSQL/pgvector and a separate retrieval schema. Retain approved originals in a separate private Bunny Storage Zone without public CDN mapping, or a private local root through the existing configurable drivers. Back up originals/approval metadata; rebuild the derived index.
- Start graph with a small explicit schema. Evaluate Auto Ontology later on bounded fictional exports; neither a graph service nor NVIDIA's whole application stack is preapproved. External MCP initially returns structured data/text; MCP Apps has its own later phase.

## Why

Each phase has a useful, independently verifiable result. The portfolio demonstrates AI engineering through real boundaries, evidence and measurements, while remaining readable and operable by one owner. Advanced demonstrations do not delay the useful first release.

## Rejected

- Coupling agent, runtime, MCP, RAG and UI into one phase or requiring RAG before the agent can run.
- Treating knowledge about Petr as visitor conversation memory, duplicating the rendered website as another source, or live crawling of unrelated sources.
- Publishing unreviewed documents, relying on a folder name to make CDN files private, or claiming a security model guarantees authorization.
- Public administration by default, direct MCP/Python database access, arbitrary SQL/URL tools and importing an enterprise platform for its ontology feature.

## Relationship to earlier decisions

This supersedes the delivery order, phase references and initial MCP Apps scope in 0012; the public-admin deployment assumption; and the original scope limits in 0010 that excluded supplemental documents and all future graph work. It qualifies 0003/0006: structured profile/roadmap facts stay public and authoritative, but pending ingest, source metadata and originals are private operational material. It extends 0008 with private knowledge storage. Earlier records remain unchanged as history; current PRDs and binding docs describe the new plan.
