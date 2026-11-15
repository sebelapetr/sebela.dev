# 0010 — Own retrieval on pgvector, hosted embeddings

Status: accepted
Date: 2026-11-15

## Decision

Retrieval is implemented in this repository: chunking, embedding, storage with pgvector in the same Postgres, and hybrid search (vector similarity and full-text). Embeddings come from a hosted API behind an interface. Cognee is not used. The variants are compared with evals and the measurements are published.

## Why

The data is small — hundreds to low thousands of chunks — and already lives in Postgres. Keeping vectors next to their source removes a service, a set of keys and a synchronisation problem, and lets vector and full-text search run in one query. An implementation written here shows the whole chain; a managed product would hide half of it.

## Rejected

- **Cognee.** A separate Python service with its own stores to run and keep in sync; more machinery than this amount of data justifies.
- **Pinecone.** Built for millions of vectors; an external dependency for what one table does, with full-text search to solve separately.
- **A local embedding model inside the API.** No dependency or cost, but memory in the container and lower quality; a hosted API is simpler, and its cost at this volume is negligible.
- **No retrieval at all.** The public profile fits in a model's context and exact questions are served by read tools. Kept as the baseline the evals compare against.
