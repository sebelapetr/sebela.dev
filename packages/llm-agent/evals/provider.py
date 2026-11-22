"""The Promptfoo provider: one case-run of the real agent against the fixture's test API.

Promptfoo (`promptfooconfig.yaml`) calls `call_api` once per case and repeat. The provider takes
the case from the test variables, runs the public package operation (`ChatAgent.run`) with the
pinned Anthropic models and the content API named by `LLM_AGENT_API_URL`, and returns the stored
record as its output. Only the approved `ChatResult` leaves the agent; drafts never do.

The model key reaches the provider only through the environment of the Promptfoo process
(`evals/run.py`); it is never a test variable, a prompt or part of the record.

A compaction case (phase 7) first compacts the working context with `ChatAgent.compact` at each
of its points: the working context grows by one earlier exchange at a time, each compaction folds
it into the summary and keeps the newest exchanges verbatim, and the final question runs on the
last summary and the exchanges kept since. Every `CompactionResult` is stored under `compactions`
and its cost counts towards the case-run.

In a Main-model comparison the runner names the candidate in `LLM_AGENT_EVAL_MAIN`; the provider
makes it the Main stage before the agent runs and passes the candidate's comparison-only execution
limits (`evals/comparison.py`). Without it the pinned stages and the agent's default limits stay.
"""

from __future__ import annotations

import json
import os
import time
from typing import TYPE_CHECKING, Any

from evals import comparison
from evals.datasets.cases import BY_ID, DATASET_VERSION, FIXED_TODAY, EvalCase

if TYPE_CHECKING:
    from llm_agent import ChatAgent, ChatExchange, ChatRequest, CompactionResult

#: The schema of one stored case-run record (`evals/run.py`, regrade compatibility).
RECORD_SCHEMA = "llm-agent-answer-v1"


def exchanges(case: EvalCase) -> tuple[ChatExchange, ...]:
    """The case's earlier exchanges as the caller passes them, oldest first."""
    from llm_agent import ChatExchange, ExchangeSource

    return tuple(
        ChatExchange(
            question=exchange.question,
            answer=exchange.answer,
            language=exchange.language,
            sources=tuple(
                ExchangeSource.model_validate(
                    {"kind": source.kind, "record_id": source.record_id, "title": source.title}
                )
                for source in exchange.sources
            ),
        )
        for exchange in case.history
    )


def chat_request(case: EvalCase) -> ChatRequest:
    """The request of one case-run without compaction: its question, the fixed day and its
    earlier exchanges."""
    from llm_agent import ChatRequest

    return ChatRequest(question=case.question, today=FIXED_TODAY, history=exchanges(case))


async def compacted_request(
    agent: ChatAgent, case: EvalCase
) -> tuple[ChatRequest, list[CompactionResult]]:
    """Compacts the working context at each of the case's points, then builds the final request
    on the last installed summary and the exchanges kept or added since."""
    from llm_agent import ChatRequest, CompactionRequest

    every = exchanges(case)
    points = case.compaction.points if case.compaction else ()
    summary = None
    working: list[ChatExchange] = []
    added = 0
    results: list[CompactionResult] = []
    for point in points:
        working.extend(every[added:point])
        added = point
        result = await agent.compact(CompactionRequest(summary=summary, exchanges=tuple(working)))
        results.append(result)
        if result.outcome == "compacted":
            summary = result.summary
            working = working[len(working) - result.kept :]
    working.extend(every[added:])
    request = ChatRequest(
        question=case.question, today=FIXED_TODAY, history=tuple(working), summary=summary
    )
    return request, results


async def call_api(prompt: str, options: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    from llm_agent import ApiContentReader, ChatAgent, anthropic_model_factory

    try:
        limits = comparison.apply_from_environment(os.environ)
    except ValueError as error:
        return {"error": str(error)}
    case_id = str(context.get("vars", {}).get("case_id", ""))
    case = BY_ID.get(case_id)
    if case is None:
        return {"error": f"unknown case {case_id!r}"}
    started = time.monotonic()
    async with ApiContentReader(os.environ["LLM_AGENT_API_URL"]) as content:
        agent = ChatAgent(content=content, models=anthropic_model_factory())
        compactions: list[CompactionResult] = []
        if case.compaction is None:
            request = chat_request(case)
        else:
            request, compactions = await compacted_request(agent, case)
        result = await agent.run(request, limits=limits)
    record: dict[str, Any] = {
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
    if case.compaction is not None:
        record["compactions"] = [item.model_dump(mode="json") for item in compactions]
    usages = [result.usage, *(item.usage for item in compactions)]
    prompt_tokens = sum(usage.input_tokens for usage in usages)
    completion = sum(usage.output_tokens for usage in usages)
    return {
        "output": json.dumps(record, ensure_ascii=False),
        "cost": sum(usage.cost_usd for usage in usages),
        "tokenUsage": {
            "prompt": prompt_tokens,
            "completion": completion,
            "total": prompt_tokens + completion,
        },
    }
