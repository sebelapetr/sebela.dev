"""Folding a working context into one bounded, validated summary (`ChatAgent.compact`).

The newest `KEPT_EXCHANGES` complete exchanges stay verbatim and are not sent; the prior summary and
every older exchange are folded by one logical call to the Main model with no tools, the
`COMPACT_PROMPT` and the `COMPACT_SCHEMA` structured output, under the gateway's one shared retry.
A reply is installed only when it parses into a `ContextSummary` in the conversation's language,
every reference is one of the inputs' references (titles come from the inputs, never the model)
and its rendered block stays within `SUMMARY_TOKEN_CAP`; anything else is an invalid attempt.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, Final, get_args

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import ValidationError

from llm_agent.context.history import history_block, summary_block
from llm_agent.context.tokens import text_tokens
from llm_agent.models.gateway import Gateway
from llm_agent.models.replies import reply_text, stop_reason
from llm_agent.prompts import COMPACT_PROMPT
from llm_agent.reliability.stops import Unavailable
from llm_agent.schemas import (
    ChatExchange,
    ContextSummary,
    ExecutionLimits,
    Language,
    SourceKind,
    SummaryReference,
)

#: The newest complete exchanges a compaction keeps verbatim; a context of no more is a no-op.
KEPT_EXCHANGES: Final = 2
#: The hard cap of one rendered summary block; the prompt targets about 1,000 tokens.
SUMMARY_TOKEN_CAP: Final = 1500
#: The span of each compaction attempt.
COMPACT_SPAN: Final = "model.compact"

_LINES: Final[dict[str, Any]] = {"type": "array", "items": {"type": "string"}}

COMPACT_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "properties": {
        "language": {"type": "string", "enum": ["en", "cs"]},
        "goals": _LINES,
        "open_questions": _LINES,
        "covered": _LINES,
        "visitor_claims": _LINES,
        "references": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(get_args(SourceKind))},
                    "record_id": {"type": "string"},
                },
                "required": ["kind", "record_id"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["language", "goals", "open_questions", "covered", "visitor_claims", "references"],
    "additionalProperties": False,
}

_Titles = dict[tuple[str, str], str]


def split(exchanges: Sequence[ChatExchange]) -> tuple[tuple[ChatExchange, ...], int]:
    """The exchanges to fold and the number of newest ones kept verbatim."""
    kept = min(len(exchanges), KEPT_EXCHANGES)
    return tuple(exchanges[: len(exchanges) - kept]), kept


async def summarize(
    gateway: Gateway,
    limits: ExecutionLimits,
    *,
    summary: ContextSummary | None,
    folded: Sequence[ChatExchange],
    language: Language,
) -> ContextSummary:
    """The validated summary of `summary` and `folded`.

    Raises `Unavailable("invalid_summary")` when no valid reply came within the retry allowance,
    and lets the gateway's `ModelUnavailable` and `LimitReached` through.
    """
    titles = _titles(summary, folded)

    def parsed(reply: BaseMessage) -> ContextSummary | None:
        if stop_reason(reply) not in (None, "end_turn"):
            return None
        return _validated(reply_text(reply), language=language, titles=titles)

    reply = await gateway.complete(
        "main",
        _messages(summary, folded, language),
        schema=COMPACT_SCHEMA,
        valid=lambda reply: parsed(reply) is not None,
        input_cap=limits.main_input_tokens,
        output_cap=limits.main_output_tokens,
        attempt_s=limits.main_attempt_s,
        span=COMPACT_SPAN,
    )
    result = parsed(reply)
    if result is None:
        raise Unavailable("invalid_summary")
    return result


def summary_tokens(summary: ContextSummary | None) -> int:
    return 0 if summary is None else text_tokens(summary_block(summary))


def _messages(
    summary: ContextSummary | None, folded: Sequence[ChatExchange], language: Language
) -> list[BaseMessage]:
    block = history_block(folded, summary=summary)
    return [
        SystemMessage(COMPACT_PROMPT),
        HumanMessage(f"{block}\nReturn the summary in the language {language}."),
    ]


def _titles(summary: ContextSummary | None, folded: Sequence[ChatExchange]) -> _Titles:
    """Every reference the inputs carry, with its newest title."""
    titles: _Titles = {}
    if summary is not None:
        for reference in summary.references:
            titles[(reference.kind, reference.record_id)] = reference.title
    for exchange in folded:
        for source in exchange.sources:
            titles[(source.kind, source.record_id)] = source.title
    return titles


def _validated(text: str, *, language: Language, titles: _Titles) -> ContextSummary | None:
    try:
        payload = json.loads(text)
        if not isinstance(payload, dict):
            return None
        summary = ContextSummary.model_validate(payload)
    except (ValueError, ValidationError):
        return None
    if summary.language != language:
        return None
    references: list[SummaryReference] = []
    seen: set[tuple[str, str]] = set()
    for reference in summary.references:
        key = (reference.kind, reference.record_id)
        if key not in titles:
            return None
        if key in seen:
            continue
        seen.add(key)
        references.append(reference.model_copy(update={"title": titles[key]}))
    filled = summary.model_copy(update={"references": tuple(references)})
    if summary_tokens(filled) > SUMMARY_TOKEN_CAP:
        return None
    return filled
