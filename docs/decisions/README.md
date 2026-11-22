# Decisions

Short records of decisions that shaped the project: what was decided, why, and what was rejected. One file per decision, numbered, never rewritten — a changed decision gets a new record that supersedes the old one.

## Format

```
# NNNN — Title

Status: accepted | superseded by NNNN
Date: YYYY-MM-DD

## Decision
## Why
## Rejected
```

## Index

| #    | Decision                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | The API is the only gateway to data                                                                                                             |
| 0002 | Hono and Drizzle for the backend                                                                                                                |
| 0003 | The database is canonical; the repository ships only a demo seed                                                                                |
| 0004 | Agents by role, knowledge in per-part AGENTS.md                                                                                                 |
| 0005 | Test-first where correctness matters, visual evidence for UI                                                                                    |
| 0006 | No visibility model until a use case needs it                                                                                                   |
| 0007 | Phase integration branch and an unattended loop                                                                                                 |
| 0008 | Object storage through an S3 interface, Bunny in the cloud, disk for tests                                                                      |
| 0009 | API keys, hashed in the database, instead of JWTs                                                                                               |
| 0010 | Own retrieval on pgvector, hosted embeddings                                                                                                    |
| 0011 | One Python service for the AI layer; promptfoo and Langfuse (superseded by 0012)                                                                |
| 0012 | [Separate AI runtime, public MCP and shared Python agent package](0012-ai-runtime-and-shared-agent-package.md)                                  |
| 0013 | [The harness lives in a top-level `harness/` folder](0013-harness-at-the-top-level.md)                                                          |
| 0014 | [The API client is generated with openapi-typescript and openapi-fetch](0014-generated-api-client.md)                                           |
| 0015 | [A caller-scoped unit of work for loading a seed](0015-caller-scoped-unit-of-work-for-the-seed.md)                                              |
| 0016 | [Incremental AI delivery and approved knowledge sources](0016-incremental-ai-and-knowledge-delivery.md)                                         |
| 0017 | [The website uses the module layout beside its routes](0017-web-module-layout.md)                                                               |
| 0018 | [The website serves stored images from its own origin](0018-images-from-the-website-origin.md)                                                  |
| 0019 | [Roadmap progress is derived on read](0019-roadmap-progress-derived-on-read.md)                                                                 |
| 0020 | [The learning diary groups time by Prague days and refuses overlaps in the database](0020-learning-diary-prague-days.md)                        |
| 0021 | [The API audits every content write in the write's own transaction](0021-api-owned-atomic-content-audit.md)                                     |
| 0022 | [RAG is split into a private knowledge base and a later integration phase](0022-rag-split-knowledge-base-and-integration.md)                    |
| 0023 | [Incremental delivery on merge, behind the server's nginx, at sebela.dev](0023-incremental-delivery-on-merge.md)                                |
| 0024 | [The Main Agent runs Claude Haiku 5.5 at medium effort](0024-main-agent-haiku-medium.md)                                                        |
| 0025 | [A deployment brings the server's checkout to the release commit](0025-deployment-brings-the-checkout-to-the-release.md)                        |
| 0026 | [Eval cost controls for phases 7, 7.1 and 8](0026-eval-cost-controls-for-later-phases.md)                                                       |
| 0027 | [Work is selected from milestones, phase tracking issues and native dependencies](0027-native-work-selection.md)                                |
| 0028 | [A merge that builds no image reaches the server with the next release](0028-merges-without-an-image-reach-the-server-with-the-next-release.md) |
