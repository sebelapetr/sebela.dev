"""Security Gateway: Haiku 5.5 at medium effort classifies the question; it never answers.

A valid verdict is returned. A provider refusal is a `BLOCK`. Output that is not a valid verdict
stops the execution as `classifier_invalid`, and a model failure after the retry allowance as
`classifier_unavailable`: a failed classifier never allows a question through.
"""

from __future__ import annotations

import json
from typing import Any, Final

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import ValidationError

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
    messages = [
        SystemMessage(SECURITY_PROMPT),
        HumanMessage(visitor_block(execution.request.question)),
    ]
    limits = execution.limits
    try:
        reply = await execution.gateway.complete(
            "security",
            messages,
            schema=VERDICT_SCHEMA,
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


def _verdict(text: str) -> Verdict:
    try:
        return Verdict.model_validate(json.loads(text))
    except (ValueError, ValidationError) as error:
        raise Unavailable("classifier_invalid") from error
