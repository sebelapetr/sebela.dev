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
