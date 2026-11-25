"""Main Agent: Haiku 5.5 at medium effort answers with the read tools and returns a draft.

The draft is held back for the Output Guard. The loop is bounded by the decision and tool caps
(restricted after an `UNCERTAIN` verdict). The last allowed decision is answer-only: the tools
stay defined but the model may not call one, so it answers from the evidence already read. A
reply that still asks for tools then stops as `main_decisions`, and more tool requests than the
cap as `tool_calls`.
A provider refusal or a `refused` draft declines the request; anything that is not a valid draft
stops as `invalid_output`.

The newest earlier exchanges (within the history caps, halved after `UNCERTAIN`), after the
caller's installed summary when it fits too, precede the question as untrusted context. Before
every decision the summary and then the oldest exchanges are dropped until the input fits the Main
input cap; the instructions, the question and every tool call with its result are never dropped,
so an input that still does not fit stops as `context_too_large`.
"""

from __future__ import annotations

import json
from typing import Any, Final

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from pydantic import ValidationError

from llm_agent.context.history import history_block, select_context
from llm_agent.context.tokens import request_tokens
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
        "unpublished": {"type": "boolean"},
    },
    "required": ["outcome", "language", "text", "source_refs", "show_contact", "unpublished"],
    "additionalProperties": False,
}


def system_text(*, uncertain: bool) -> str:
    return f"{CHAT_PROMPT}\n{UNCERTAIN_RESTRICTION}" if uncertain else CHAT_PROMPT


async def answer(execution: Execution, *, uncertain: bool) -> Draft | None:
    """The draft for the Output Guard, or None when the request is declined as out of scope."""
    tracer = execution.tracer
    started = tracer.start()
    context = _Context(execution, uncertain=uncertain)
    try:
        result = await _loop(execution, context, uncertain=uncertain)
    except ModelUnavailable as error:
        tracer.finish("stage.main", "error", started, **context.labels(uncertain))
        raise Unavailable("model_unavailable") from error
    except ExecutionStopped as stop:
        tracer.finish("stage.main", stop.reason, started, **context.labels(uncertain))
        raise
    tracer.finish(
        "stage.main",
        "ok",
        started,
        declined=result is None,
        **context.labels(uncertain),
    )
    return result


class _Context:
    """The opening of the Main conversation: the dated, language-tagged question and its history."""

    def __init__(self, execution: Execution, *, uncertain: bool) -> None:
        limits = execution.limits
        request = execution.request
        self._summary, self._history = select_context(
            request.history,
            request.summary,
            max_exchanges=limits.history_exchanges,
            max_tokens=limits.uncertain_history_tokens if uncertain else limits.history_tokens,
        )
        # The caller's Europe/Prague calendar day, so "this week" or "recently" has a fixed anchor.
        dated = f"<today>{request.today.isoformat()}</today>\n" if request.today else ""
        self._head = dated + f"<visitor_language>{execution.language}</visitor_language>\n"
        self._question = visitor_block(request.question)
        self._cap = limits.main_input_tokens

    def labels(self, uncertain: bool) -> dict[str, bool | int]:
        """The stage span's attributes: what of the working context the model was shown."""
        return {
            "uncertain": uncertain,
            "history_exchanges": len(self._history),
            "history_summary": self._summary is not None,
        }

    def opening(self) -> HumanMessage:
        history = history_block(self._history, summary=self._summary)
        return HumanMessage(self._head + (f"{history}\n" if history else "") + self._question)

    def fit(self, messages: list[BaseMessage]) -> None:
        """Drops the summary, then the oldest exchanges, from `messages[1]` until the request fits
        the input cap."""
        while (self._summary or self._history) and self._over(messages):
            if self._summary is not None:
                self._summary = None
            else:
                self._history = self._history[1:]
            messages[1] = self.opening()

    def _over(self, messages: list[BaseMessage]) -> bool:
        return request_tokens(messages, TOOL_SPECS, DRAFT_SCHEMA) > self._cap


async def _loop(execution: Execution, context: _Context, *, uncertain: bool) -> Draft | None:
    limits = execution.limits
    decisions = limits.uncertain_main_decisions if uncertain else limits.main_decisions
    tool_cap = limits.uncertain_tool_calls if uncertain else limits.tool_calls
    messages: list[BaseMessage] = [
        SystemMessage(system_text(uncertain=uncertain)),
        context.opening(),
    ]
    executed = 0
    for decision in range(1, decisions + 1):
        context.fit(messages)
        reply = await execution.gateway.complete(
            "main",
            messages,
            schema=DRAFT_SCHEMA,
            tools=TOOL_SPECS,
            # The last allowed decision may not ask for tools: it answers from what was read.
            answer_only=decision == decisions,
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
            # Only if the provider ignores the answer-only tool choice.
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
