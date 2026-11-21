# Published retrieval eval results

Each file is the redacted summary of a paid run of `node evals/run.js --publish <name>`: the
retrieval variant and settings it measured, the aggregate and per-question metrics, the pending
cases and the run's provider usage and cost. Nothing here holds a key, a passage text or a
database name. Local runs without `--publish` stay in the checkout's `.tmp/evals/memory/`.

## Relevance floor and final count

The deployed search applies `RETRIEVAL_RELEVANCE_FLOOR` to the reranker's score. It was
calibrated in #226 on `reranked-calibration.json`, a reranked run with the floor at 0 and the
final count at 8, by recomputing the metrics offline for floors 0.36 to 0.41 and final counts
5 to 8:

- Floors 0.36 to 0.40 give the same nDCG (0.94), hit rate (1), correct-empty rate (0.8) and no
  false empty; precision rises with the floor. At 0.41 two answerable questions lose their hit
  (their answering passage scores 0.405).
- The no-answer questions' best passages score at most 0.353, except `no-answer-hourly-rate`,
  whose best passage scores 0.528 and cannot be separated by any floor that keeps the hits. It
  is the one failing case of the deployed run.
- Final counts 5 to 8 give the same nDCG, hit rate and correct-empty rate; 5 has the best
  precision.

The deployed values are a floor of 0.38, which leaves margin on both sides, and a final count of
5 from a pool of 30. The pool stays at 30: recall at the pool is already 1 at that size in
every vector-based variant, so a larger pool cannot add an answering passage, and each extra
candidate is one more document in every rerank call (about 1,100 rerank tokens per query at
30). A smaller pool was not measured, to keep paid runs down. Chunking is unchanged for the same
reason: recall at the pool is already 1. These values are
calibrated on the same questions they are measured on, so the reranked metrics are in-sample.
The floor of 0.3 in the earlier vector and full-text runs was a placeholder.

## Spend

Paid runs count against the phase 9 ceiling of USD 3, with a stop at USD 1 per run.

| Run                         | Date       | Tokens | Cost (USD) |
| --------------------------- | ---------- | -----: | ---------: |
| `vector-baseline.json`      | 2026-11-20 |  4,223 |    0.00025 |
| `supplemental-vector.json`  | 2026-11-21 |  7,595 |    0.00046 |
| `fulltext-baseline.json`    | 2026-11-21 |  4,137 |    0.00025 |
| `vector-complete.json`      | 2026-11-21 |  4,571 |    0.00027 |
| `hybrid-complete.json`      | 2026-11-21 |  4,571 |    0.00027 |
| `reranked-calibration.json` | 2026-11-21 | 57,688 |    0.00296 |
| `reranked-complete.json`    | 2026-11-21 | 54,312 |    0.00276 |

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
The three runs of #226 add about USD 0.0060, so the cumulative phase 9 spend is about
USD 0.0093 of USD 3. Their reranker calls (50,175 tokens per complete run) are most of it.

`reranked-calibration.json` records 7,513 index tokens against 4,137 in the other complete runs,
and its portfolio reindex reports 132 chunks embedded and none reused. Every run indexes a fresh
temporary database. The eval's API server starts its indexing queue on the seeded content while
the eval runs `knowledge reindex`. In the other runs the queue had stored most vectors by the
time the reindex reached them, so the reindex reused them. In the calibration run the reindex
started before that, so both embedded the whole corpus, about USD 0.0002 extra. This is the
single-runner caveat of the indexing queue (`docs/architecture.md`), seen in the eval harness.
It is not caused by the reranked search.

## Four variants side by side

All four measure the complete question set (45 questions, 40 answerable) with the same index,
pool of 30 and query cache. `hybrid` fuses the vector and full-text lists by reciprocal rank and
returns the pool's order without a floor; `reranked` scores that pool with `rerank-3` and
applies the floor of 0.38 and the final count of 5. The other three
return at most 6 passages; only `vector` applies a floor, the placeholder of 0.3 on its cosine
similarity.

| Variant                          |  nDCG | Recall@pool | Precision |   MRR |  Hit | Correct empty | False empty | p50 / p95 ms | USD per query |
| -------------------------------- | ----: | ----------: | --------: | ----: | ---: | ------------: | ----------: | -----------: | ------------: |
| `fulltext` (`fulltext-baseline`) | 0.630 |       0.838 |     0.203 | 0.643 | 0.78 |           0.2 |       0.025 |      35 / 86 |             0 |
| `vector` (`vector-complete`)     | 0.907 |           1 |     0.422 | 0.938 | 0.98 |           0.2 |           0 |      52 / 74 |             0 |
| `hybrid` (`hybrid-complete`)     | 0.803 |           1 |     0.237 | 0.796 | 0.95 |             0 |           0 |      33 / 43 |             0 |
| `reranked` (`reranked-complete`) | 0.938 |           1 |     0.515 | 0.942 |    1 |           0.8 |           0 |    284 / 486 |     0.0000558 |

The reranker lifts nDCG, precision and the hit rate and is the only variant that tells most
no-answer questions apart (four of five); it costs about 250 ms and USD 0.000056 per query, its
rerank call. Fusion alone ranks worse than the vector list, because full-text candidates with
weak matches displace good vector ones, but it keeps recall at the pool at 1 for the reranker.
Latency and cost leave out the query embedding, which came from the cache in every run (see
Query cache); an uncached query adds one embedding call.

## The frozen gate

`../thresholds.json` froze the gate in #225 from `vector-complete.json`: it gates only what the
phase PRD gates, recall at the pool, nDCG and the correct-empty rate, at its values rounded down
to two decimals (1, 0.9 and 0.2); every other metric is reported, not gated. The gate applies to
a complete run of the deployed variant the file names. #226 deploys the reranked pipeline and
switches `variant` to `reranked` with the minimums unchanged, since its values are in-sample (see
Relevance floor and final count). `reranked-complete.json` meets every minimum: recall at the
pool 1, nDCG 0.94 and a correct-empty rate of 0.8. The file records all four baselines.

The `gate` block inside `reranked-complete.json` says `applies: false`: the run was made while
the file still named `vector`, so the gate did not apply to it then. The published JSON is left
as the run wrote it. Recomputing the gate from that summary's metrics against the current
`../thresholds.json` (`gateOf` in `../run.js`) gives `applies: true`, `passed: true` and no
failures; the next complete reranked run records that itself. A later
slice may only raise the minimums.
