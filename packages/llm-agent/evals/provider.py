"""The Promptfoo provider: one case-run of the real agent against the fixture's test API.

Promptfoo (`promptfooconfig.yaml`) calls `call_api` once per case and repeat. The provider takes
the case from the test variables, runs the public package operation (`ChatAgent.run`) with the
pinned Anthropic models and the content API named by `LLM_AGENT_API_URL`, and returns the stored
record as its output. Only the approved `ChatResult` leaves the agent; drafts never do.

The model key reaches the provider only through the environment of the Promptfoo process
(`evals/run.py`); it is never a test variable, a prompt or part of the record.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from evals.datasets.cases import BY_ID, DATASET_VERSION, FIXED_TODAY

#: The schema of one stored case-run record (`evals/run.py`, regrade compatibility).
RECORD_SCHEMA = "llm-agent-answer-v1"


async def call_api(prompt: str, options: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    from llm_agent import ApiContentReader, ChatAgent, ChatRequest, anthropic_model_factory

    case_id = str(context.get("vars", {}).get("case_id", ""))
    case = BY_ID.get(case_id)
    if case is None:
        return {"error": f"unknown case {case_id!r}"}
    started = time.monotonic()
    async with ApiContentReader(os.environ["LLM_AGENT_API_URL"]) as content:
        agent = ChatAgent(content=content, models=anthropic_model_factory())
        result = await agent.run(ChatRequest(question=case.question, today=FIXED_TODAY))
    record = {
        "record_schema": RECORD_SCHEMA,
        "case_id": case.id,
        "fingerprint": {
            "dataset_version": DATASET_VERSION,
            "record_schema": RECORD_SCHEMA,
            "subject": result.versions.model_dump(mode="json"),
        },
        "result": result.model_dump(mode="json"),
        "latency_ms": round((time.monotonic() - started) * 1000),
    }
    usage = result.usage
    return {
        "output": json.dumps(record, ensure_ascii=False),
        "cost": usage.cost_usd,
        "tokenUsage": {
            "prompt": usage.input_tokens,
            "completion": usage.output_tokens,
            "total": usage.input_tokens + usage.output_tokens,
        },
    }
