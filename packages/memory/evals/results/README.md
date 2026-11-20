# Published retrieval eval results

Each file is the redacted summary of a paid run of `node evals/run.js --publish <name>`: the
retrieval variant and settings it measured, the aggregate and per-question metrics, the pending
cases and the run's provider usage and cost. Nothing here holds a key, a passage text or a
database name. Local runs without `--publish` stay in the checkout's `.tmp/evals/memory/`.
