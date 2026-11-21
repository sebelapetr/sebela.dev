# Published retrieval eval results

Each file is the redacted summary of a paid run of `node evals/run.js --publish <name>`: the
retrieval variant and settings it measured, the aggregate and per-question metrics, the pending
cases and the run's provider usage and cost. Nothing here holds a key, a passage text or a
database name. Local runs without `--publish` stay in the checkout's `.tmp/evals/memory/`.

## Relevance floor

The `RETRIEVAL_RELEVANCE_FLOOR` of 0.3 in these runs (and in `.env.example`) is a placeholder,
not a calibrated value. The baseline's correct-empty rate of 0.4 reflects that. The calibrated
floor comes with the deployed two-stage ranking (S05 in `.plan/09-rag/issues.md`) and is
measured against these questions.

## Spend

Paid runs count against the phase 9 ceiling of USD 3, with a stop at USD 1 per run.

| Run                        | Date       | Tokens | Cost (USD) |
| -------------------------- | ---------- | -----: | ---------: |
| `vector-baseline.json`     | 2026-11-20 |  4,223 |    0.00025 |
| `supplemental-vector.json` | 2026-11-21 |  7,595 |    0.00046 |
| `fulltext-baseline.json`   | 2026-11-21 |  4,137 |    0.00025 |
| `vector-complete.json`     | 2026-11-21 |  4,571 |    0.00027 |

`supplemental-vector.json` measures only the six supplemental-document cases, after ingesting
and approving their fictional documents; all six pass.

## Query cache

Runs keep query embeddings in the checkout's `.tmp/evals/memory/query-cache.json`, so a repeated
question costs nothing. A run's `candidates` step embeds the questions the cache lacks, and the
measured searches then find every question there. Each summary records this in
`spend.queryCache`: the entries at the start, and for the `candidates` and `search` steps how
many questions came from the cache and how many were embedded. Whenever searches are served
from the cache, the published `latencyMs` and `costPerQueryUsd` leave out the embedding call:
they measure retrieval after the query is embedded, not a visitor's uncached search.

In `supplemental-vector.json` the cache started empty, the `candidates` step embedded all six
questions (63 tokens) and all six searches came from the cache (0 search tokens). That is why
its p95 latency is 110 ms and its cost per query is 0, against 3,388 ms in the uncached
`vector-baseline.json`. The run predates the `spend.queryCache` field; its values were added
afterwards from the run's recorded usage and the cache file, which held exactly those six
entries.

Cumulative phase 9 spend after the two baselines of #225: about USD 0.0033 of USD 3 (the runs
above plus earlier paid runs of the phase). The full-text baseline embeds only while indexing.

## Baselines and the frozen gate

`fulltext-baseline.json` (`--variant fulltext`) and `vector-complete.json` (`--variant vector`)
measure the complete question set, including the supplemental documents and the seeded conflict,
with the same settings. `vector-baseline.json` is the earlier vector run over the first 39
questions, kept for comparison. The vector variant is the deployed one: nDCG 0.91 against 0.63,
recall at the pool 1 against 0.84, and no false empty against 0.025.

`../thresholds.json` freezes the gate from `vector-complete.json`: it gates only what the phase PRD
gates, recall at the pool, nDCG and the correct-empty rate, at its values rounded down to two
decimals; every other metric is reported, not gated (the file states the method and both
baselines). The gate applies to a complete run of the deployed variant the file names, now
`vector`; a slice that deploys another pipeline (the hybrid or reranked variant) switches
`variant` to it in the same change, and the new pipeline must meet the same minimums. A later
slice may only raise them.
