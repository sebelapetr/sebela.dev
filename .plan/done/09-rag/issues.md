# Phase 9 — Issues

Source: [RAG knowledge base PRD](prd.md). The owner approved the PRD, this issue file and immediate GitHub publication on 2026-11-20, asking for as few complete slices as possible without losing quality. No further draft-approval round is required.

Published on 2026-11-20: **7 issues, 6 AFK and 1 HITL**. All carry `phase:09-rag`, `ready-for-agent` and exactly one of `afk`/`hitl`. Publication starts no implementation, paid eval or phase loop.

## Prerequisites and scheduling

Phase 9 depends only on phases 2 and 4, which are merged. The PR publishing this file must be owner-merged before `phase/09-rag` is cut from `master`. By owner decision the loop runs in its own tmux session (`phase-09`) after phase 6 finishes, in parallel with phase 7. The phase pull request into `master` waits until phases 7 and 8 are merged (S07).

## Published breakdown

| Slice | Issue                                                       | Title                                                                                         | Type | Blocked by                                                                         | Stories         |
| ----- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- | --------------- |
| S01   | [#222](https://github.com/sebelapetr/sebela.dev/issues/222) | Search the indexed portfolio through a private, measured retrieval route                      | AFK  | None                                                                               | 20–22, 25, 27   |
| S02   | [#223](https://github.com/sebelapetr/sebela.dev/issues/223) | Keep portfolio passages current after every content write within an embedding ceiling         | AFK  | [#222](https://github.com/sebelapetr/sebela.dev/issues/222)                        | 14–19           |
| S03   | [#224](https://github.com/sebelapetr/sebela.dev/issues/224) | Ingest, review and approve a Markdown or text document kept in private storage                | AFK  | [#223](https://github.com/sebelapetr/sebela.dev/issues/223)                        | 1, 3–6, 13, 23  |
| S04   | [#225](https://github.com/sebelapetr/sebela.dev/issues/225) | Replace, withdraw, delete and rebuild sources, keep API facts first and freeze thresholds     | AFK  | [#224](https://github.com/sebelapetr/sebela.dev/issues/224)                        | 7–12, 24, 26    |
| S05   | [#226](https://github.com/sebelapetr/sebela.dev/issues/226) | Rank passages with hybrid search and a cross-encoder reranker that meet the frozen thresholds | AFK  | [#225](https://github.com/sebelapetr/sebela.dev/issues/225)                        | 20, 21, 25      |
| S06   | [#227](https://github.com/sebelapetr/sebela.dev/issues/227) | Ingest text-layer PDF documents through the same checks and approval                          | AFK  | [#226](https://github.com/sebelapetr/sebela.dev/issues/226)                        | 1, 2            |
| S07   | [#228](https://github.com/sebelapetr/sebela.dev/issues/228) | Accept phase 09 with private Bunny storage, a real document and the complete suite            | HITL | [#227](https://github.com/sebelapetr/sebela.dev/issues/227); phases 7 and 8 merged | Acceptance; all |

## Why seven slices

- **S01** is the tracer bullet: package, schema, portfolio indexing, vector search, private route, contract and the eval runner with the complete question set. Later slices extend it; none is setup-only.
- **S02** makes indexing automatic and safe (write hook, persisted queue, restart, ceiling, rebuild after a model change).
- **S03** adds the supplemental-document path with private storage, sensitivity checks and exact-version approval, for Markdown and text.
- **S04** completes the source lifecycle and API precedence, and freezes the thresholds on the complete set before ranking work starts.
- **S05** delivers the deployed two-stage ranking (hybrid candidates, fixed cross-encoder reranker, calibrated floor) against those thresholds.
- **S06** keeps PDF separate so a parser problem cannot block the rest.
- **S07** is the only HITL slice: a private Bunny zone, live checks and a real document need the owner, and the final sync with `master` happens after phases 7 and 8.

The chain is sequential: the slices share the retrieval schema, the memory package and the eval set, so parallel editing would collide. Parent-child/neighbour retrieval and BM25 are phase 9.2; public search, the agent tool and public MCP search are phase 9.1.

## Shared rules

Every issue repeats these: TypeScript in the API backend only; nothing public; Voyage behind the provider interfaces with fakes in ordinary tests; the key only through the secret wrapper; USD 3 for the whole phase with a USD 1 stop per run and a cost summary after every paid run; thresholds never lowered; migrations renumbered once at the end.
