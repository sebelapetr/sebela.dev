"""Main Agent: Haiku 5.5 at high effort answers with the read tools and returns a structured draft.

The draft is held back for the Output Guard. The loop is bounded by the decision and tool caps
(restricted after an `UNCERTAIN` verdict): a decision that still asks for tools when no further
decision is allowed stops as `main_decisions`, and more tool requests than the cap as `tool_calls`.
A provider refusal or a `refused` draft declines the request; anything that is not a valid draft
stops as `invalid_output`.
"""

from __future__ import annotations

import json
from typing import Any, Final

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from pydantic import ValidationError

from llm_agent.guardrails.input import visitor_block
from llm_agent.guardrails.output import Draft
from llm_agent.models.gateway import ModelUnavailable
from llm_agent.models.replies import reply_text, stop_reason
from llm_agent.pipelines.chat.state import Execution
from llm_agent.prompts import CHAT_PROMPT, UNCERTAIN_RESTRICTION
from llm_agent.reliability.stops import ExecutionStopped, LimitReached, Unavailable
from llm_agent.tools.registry import TOOL_SPECS

DRAFT_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": ["answered", "insufficient_evidence", "refused"]},
        "language": {"type": "string", "enum": ["en", "cs"]},
        "text": {"type": "string"},
        "source_refs": {"type": "array", "items": {"type": "string"}},
        "show_contact": {"type": "boolean"},
    },
    "required": ["outcome", "language", "text", "source_refs", "show_contact"],
    "additionalProperties": False,
}


def system_text(*, uncertain: bool) -> str:
    return f"{CHAT_PROMPT}\n{UNCERTAIN_RESTRICTION}" if uncertain else CHAT_PROMPT


async def answer(execution: Execution, *, uncertain: bool) -> Draft | None:
    """The draft for the Output Guard, or None when the request is declined as out of scope."""
    tracer = execution.tracer
    started = tracer.start()
    try:
        result = await _loop(execution, uncertain=uncertain)
    except ModelUnavailable as error:
        tracer.finish("stage.main", "error", started, uncertain=uncertain)
        raise Unavailable("model_unavailable") from error
    except ExecutionStopped as stop:
        tracer.finish("stage.main", stop.reason, started, uncertain=uncertain)
        raise
    tracer.finish(
        "stage.main",
        "ok",
        started,
        uncertain=uncertain,
        declined=result is None,
    )
    return result


async def _loop(execution: Execution, *, uncertain: bool) -> Draft | None:
    limits = execution.limits
    decisions = limits.uncertain_main_decisions if uncertain else limits.main_decisions
    tool_cap = limits.uncertain_tool_calls if uncertain else limits.tool_calls
    language = execution.language
    today = execution.request.today
    # The caller's Europe/Prague calendar day, so "this week" or "recently" has a fixed anchor.
    dated = f"<today>{today.isoformat()}</today>\n" if today is not None else ""
    messages: list[BaseMessage] = [
        SystemMessage(system_text(uncertain=uncertain)),
        HumanMessage(
            dated
            + f"<visitor_language>{language}</visitor_language>\n"
            + visitor_block(execution.request.question)
        ),
    ]
    executed = 0
    for decision in range(1, decisions + 1):
        reply = await execution.gateway.complete(
            "main",
            messages,
            schema=DRAFT_SCHEMA,
            tools=TOOL_SPECS,
            input_cap=limits.main_input_tokens,
            output_cap=limits.main_output_tokens,
            attempt_s=limits.main_attempt_s,
        )
        reason = stop_reason(reply)
        if reason == "refusal":
            return None
        if reason == "max_tokens":
            raise Unavailable("invalid_output")
        calls = reply.tool_calls if isinstance(reply, AIMessage) else []
        if not calls:
            draft = _draft(reply_text(reply))
            return None if draft.outcome == "refused" else draft
        if decision == decisions:
            raise LimitReached("main_decisions")
        if executed + len(calls) > tool_cap:
            raise LimitReached("tool_calls")
        messages.append(reply)
        contents = await execution.tools.call_many(
            [(call["name"], call.get("args") or {}) for call in calls]
        )
        executed += len(calls)
        for call, content in zip(calls, contents, strict=True):
            messages.append(ToolMessage(content=content, tool_call_id=str(call.get("id") or "")))
    raise LimitReached("main_decisions")  # pragma: no cover - the loop returns or raises


def _draft(text: str) -> Draft:
    try:
        return Draft.model_validate(json.loads(text))
    except (ValueError, ValidationError) as error:
        raise Unavailable("invalid_output") from error
