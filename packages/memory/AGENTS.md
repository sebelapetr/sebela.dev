# @sebela/memory

The knowledge and retrieval layer: portfolio ingest, embedding indexing and passage search behind ports. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A library called only by the API backend through `@sebela/services` (dependency table in `docs/repository-structure.md`). It may import `@sebela/contracts` and `@sebela/config` only; it never imports `@sebela/db`. `packages/db` implements its persistence ports and `packages/services` composes it with them and the Voyage adapter (`.plan/09-rag/prd.md`).

## Evals

The retrieval evals live in `evals/` and run with Promptfoo (`docs/testing.md`, Memory evals):

| File                           | What it holds                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `datasets/questions.json`      | The fictional EN/CS question set: graded relevance (2/1), canonical paths of judged sources, no-answer questions. |
| `datasets/documents/`          | Fictional supplemental documents, including one contradicting an API fact and one with injected instructions.     |
| `plan.js`                      | Which cases the system can answer yet (`SEARCHABLE`); every other case is pending, never passed.                  |
| `graders/metrics.js`           | recall@pool, nDCG, precision, MRR, correct/false empty, provenance accuracy, latency percentiles, cost per query. |
| `graders/index.js`, `tests.js` | The Promptfoo grader and test generator.                                                                          |
| `provider.js`                  | The Promptfoo provider: calls the private search route; never sees the embedding provider's key.                  |
| `run.js`                       | The runner (`pnpm --filter @sebela/memory eval [--case <id>] [--publish <name>] [--max-cost-usd <n>]`).           |
| `thresholds.json`              | The gate; not frozen until the deployed variant is chosen.                                                        |
| `results/`                     | Published summaries of paid runs.                                                                                 |

`evals/evals.test.ts` checks the dataset, metrics, plan and options deterministically; it runs with `pnpm test`.

## Module map

The public interface is `src/index.ts`; modules import each other only through their `index.ts`.

| Module                  | Entry                            | Responsibility and hidden decisions                                                                                                                                                                                                                                                                              | Depends on                            | Tests                                 |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| `src/modules/ports`     | `src/modules/ports/index.ts`     | The ports: `Embedder`, `RetrievalStore` (implemented structurally by `packages/db`), `PortfolioSnapshot`; `readRetrievalConfig(env)` (all `RETRIEVAL_*` settings or none, errors naming the setting); `ProviderUnavailableError`, `BudgetExhaustedError`. No SQL, HTTP or wire format.                           | `@sebela/contracts`                   | `src/modules/ports/index.test.ts`     |
| `src/modules/ingest`    | `src/modules/ingest/index.ts`    | `portfolioSources(snapshot)`: one source per public record with its canonical site path, sections by field, bounded chunks with text hashes and a version hash per source. Nothing private (the contact email) is indexed.                                                                                       | `ports`, `@sebela/contracts`          | `src/modules/ingest/index.test.ts`    |
| `src/modules/providers` | `src/modules/providers/index.ts` | `createVoyageEmbedder(options)` (the Voyage AI wire format, `input_type`, `output_dimension`, timeout; a failure or bad answer is `ProviderUnavailableError`, never echoing the key) and `createFakeEmbedder()`, a deterministic bag-of-words embedder for tests (optionally failing like an outage).            | `ports`                               | `src/modules/providers/index.test.ts` |
| `src/modules/spend`     | `src/modules/spend/index.ts`     | Every paid provider call: refused with `BudgetExhaustedError` once the calendar month's (UTC) recorded spend reached the ceiling, recorded with its tokens and estimated cost after it answered.                                                                                                                 | `ports`                               | `src/index.test.ts`                   |
| `src/modules/indexing`  | `src/modules/indexing/index.ts`  | `createIndexer(options)`: brings the index in step with a snapshot, embedding only chunks whose text hash has no stored vector for the model, in bounded batches, and removing sources no longer present; returns an `IndexReport` with tokens and cost.                                                         | `ports`, `ingest`, `spend`            | `src/index.test.ts`                   |
| `src/modules/retrieval` | `src/modules/retrieval/index.ts` | `createRetriever(options)`: `search(request)` embeds the query within the ceiling, takes the nearest chunks of the configured model, keeps each source's best chunk at or above the relevance floor and returns contract passages or `no_evidence`; `candidates(query, kinds?)` the same pool without the floor. | `ports`, `spend`, `@sebela/contracts` | `src/index.test.ts`                   |
