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

| Run                    | Date       | Tokens | Cost (USD) |
| ---------------------- | ---------- | -----: | ---------: |
| `vector-baseline.json` | 2026-11-20 |  4,223 |    0.00025 |

Cumulative phase 9 spend after the vector baseline: about USD 0.0023 of USD 3 (the baseline
plus earlier paid runs of the phase).
