"""Security Gateway: Haiku 5.5 at medium effort classifies the question; it never answers.

A valid verdict is returned. A provider refusal is a `BLOCK`. Output that is not a valid verdict
is asked for once more within the execution's single retry allowance and deadline; a second
invalid reply (or one when no retry is left) stops the execution as `classifier_invalid`, and a
model failure after the retry allowance as `classifier_unavailable`: a failed or invalid
classifier never allows a question through.

The classifier sees the newest earlier exchanges, after the installed summary when it fits too, as
untrusted context for the current question, within the history caps and its own input cap; the
current question is always sent complete.
"""

from __future__ import annotations

import json
from typing import Any, Final

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import ValidationError

from llm_agent.context.history import history_block, select_context
from llm_agent.context.tokens import request_tokens
from llm_agent.guardrails.input import visitor_block
from llm_agent.models.gateway import ModelUnavailable
from llm_agent.models.replies import reply_text, stop_reason
from llm_agent.pipelines.chat.state import Execution, Verdict
from llm_agent.prompts import SECURITY_PROMPT
from llm_agent.reliability.stops import ExecutionStopped, Unavailable

VERDICT_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["ALLOW", "BLOCK", "UNCERTAIN"]},
        "category": {
            "type": "string",
            "enum": ["none", "injection", "prompt_extraction", "admin_write", "off_topic", "abuse"],
        },
        "reason_code": {"type": "string"},
    },
    "required": ["verdict", "category", "reason_code"],
    "additionalProperties": False,
}

PROVIDER_REFUSAL: Final = Verdict(verdict="BLOCK", category="abuse", reason_code="provider_refusal")


async def classify(execution: Execution) -> Verdict:
    tracer = execution.tracer
    started = tracer.start()
    limits = execution.limits
    messages = _messages(execution)
    try:
        reply = await execution.gateway.complete(
            "security",
            messages,
            schema=VERDICT_SCHEMA,
            valid=_readable,
            input_cap=limits.security_input_tokens,
            output_cap=limits.security_output_tokens,
            attempt_s=limits.security_attempt_s,
        )
        result = (
            _verdict(reply_text(reply)) if stop_reason(reply) != "refusal" else PROVIDER_REFUSAL
        )
    except ModelUnavailable as error:
        tracer.finish("stage.security", "error", started, verdict=None)
        raise Unavailable("classifier_unavailable") from error
    except ExecutionStopped as stop:
        tracer.finish("stage.security", stop.reason, started, verdict=None)
        raise
    tracer.finish(
        "stage.security",
        "ok",
        started,
        verdict=result.verdict,
        category=result.category,
        reason_code=result.reason_code,
    )
    return result


def _messages(execution: Execution) -> list[BaseMessage]:
    """The classifier input: the newest exchanges that fit beside the complete question."""
    limits = execution.limits
    question = visitor_block(execution.request.question)
    bare: list[BaseMessage] = [SystemMessage(SECURITY_PROMPT), HumanMessage(question)]
    room = limits.security_input_tokens - request_tokens(bare, (), VERDICT_SCHEMA)
    summary, history = select_context(
        execution.request.history,
        execution.request.summary,
        max_exchanges=limits.history_exchanges,
        max_tokens=max(min(limits.history_tokens, room - 1), 0),
    )
    block = history_block(history, summary=summary)
    if not block:
        return bare
    return [SystemMessage(SECURITY_PROMPT), HumanMessage(f"{block}\n{question}")]


def _readable(reply: BaseMessage) -> bool:
    """A provider refusal or a valid verdict; anything else earns the single retry."""
    if stop_reason(reply) == "refusal":
        return True
    try:
        _verdict(reply_text(reply))
    except Unavailable:
        return False
    return True


def _verdict(text: str) -> Verdict:
    try:
        return Verdict.model_validate(json.loads(text))
    except (ValueError, ValidationError) as error:
        raise Unavailable("classifier_invalid") from error
