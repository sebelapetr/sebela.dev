# 0022 — RAG is split into a private knowledge base and a later integration phase

Status: accepted
Date: 2026-11-20

## Decision

- Phase 9 builds the knowledge base only: ingest, private originals, approval, chunking, embeddings, index, measured retrieval and an authenticated private search route, all in the TypeScript API backend. It depends on phases 2 and 4, not on 6, 7 or 8, and runs in a second phase loop alongside phase 7.
- Phase 9.1 connects it after phases 7, 8 and 9: public search with retrieval and overall-AI budget admission on phase 7's ledger, the agent's `search_knowledge` tool and skill, public MCP search and the supplemental-source Sources contract.
- Phase 9.2 follows with BM25 ranking inside Postgres and parent-child/neighbour retrieval, which phase 9's data model prepares for. It does not block phase 10.
- The agent reaches retrieval through a tool that calls the API over HTTP, like its other reads. It decides when to search; retrieval is not run before every answer.
- The initial embeddings model is Voyage AI `voyage-4`, behind the replaceable embedder of 0010. Phase 9 evals use no LLM judge, need no owner stop inside the loop and have a USD 3 cap.

## Why

The knowledge base has no runtime dependency on the agent or the chat; only public exposure and spend admission do. Splitting there lets two loops work at once without either waiting, and keeps anonymous paid queries out until the shared ledger exists. Voyage is at least as cheap as the alternatives at this volume and strong on multilingual retrieval.

## Rejected

- Python reading the database or a Python copy of retrieval; an MCP hop between the agent and retrieval; a separate memory service.
- A public search route in phase 9 with its own temporary ledger.
- Retrieval injected before every answer instead of a tool.

## Relationship to earlier decisions

Refines the delivery order of 0016 (phase 9 no longer depends on 7 and 8; 9.1 is added before 10) and the provider choice left open by 0010. Earlier records remain unchanged.
