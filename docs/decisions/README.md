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

| # | Decision |
|---|---|
| 0001 | The API is the only gateway to data |
| 0002 | Hono and Drizzle for the backend |
| 0003 | The database is canonical; the repository ships only a demo seed |
| 0004 | Agents by role, knowledge in per-part AGENTS.md |
| 0005 | Test-first where correctness matters, visual evidence for UI |
| 0006 | No visibility model until a use case needs it |
| 0007 | Phase integration branch and an unattended loop |
| 0008 | Object storage through an S3 interface, Bunny in the cloud, disk for tests |
| 0009 | API keys, hashed in the database, instead of JWTs |
| 0010 | Own retrieval on pgvector, hosted embeddings |
| 0011 | One Python service for the AI layer; promptfoo and Langfuse (superseded by 0012) |
| 0012 | [Separate AI runtime, public MCP and shared Python agent package](0012-ai-runtime-and-shared-agent-package.md) |
