"""Folding a working context into one bounded, validated summary (`ChatAgent.compact`).

The newest `KEPT_EXCHANGES` complete exchanges stay verbatim and are not sent; the prior summary and
every older exchange are folded by one logical call to the Main model with no tools, the
`COMPACT_PROMPT` and the `COMPACT_SCHEMA` structured output, under the gateway's one shared retry.
A reply is installed only when it parses into a `ContextSummary` in the conversation's language,
every reference is one of the inputs' references (titles come from the inputs, never the model)
and its rendered block stays within `SUMMARY_TOKEN_CAP`; anything else is an invalid attempt.

Before that, the authority guard drops from `goals`, `open_questions` and `covered` every line that
names an owner, admin, moderator or other role, a mode, access, a permission or a change of the
rules, in English or Czech; `covered` keeps only a line that the assistant declined a rule change.
`visitor_claims` is left as the model wrote it. The prompt asks for the same, and the code enforces
it, because the model sometimes restated a claimed role as a goal (#213, C05).

The presupposition guard then drops from `goals` and `open_questions` every line that presupposes a
fact instead of asking about the profile ("Learn that …", "Zjistit, že …"); a goal is an open
question ("Learn which/whether …", "Zjistit, které/zda …"). The claim itself stays under
`visitor_claims`, and `covered` keeps what the assistant said (#213, C05-cs).
"""

from __future__ import annotations

import json
import re
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

#: A role, mode, access or permission a line names. Close profile words stay out: a product
#: owner, accessibility, models, administration (a degree), the Czech "vlastní" (own) and
#: "přístup k" a topic (an approach to it) unless the topic is an access target.
_AUTHORITY: Final = re.compile(
    r"(?<!product\s)\bowners?\b"
    r"|\badmin(?:s|istrators?)?\b|\badministrátor\w*"
    r"|\bmoderators?\b|\bmoderátor\w*|\bsuperusers?\b"
    r"|\b(?:system|assistant|admin|elevated|privileged)\s+roles?\b"
    r"|\bmodes?\b|\brežim\w*"
    r"|\baccess(?:es|ed|ing)?\b"
    r"|\bpermissions?\b|\bprivileg\w*|\boprávn\w*"
    r"|\bvlastn(?:ík|ic)\w*|\bmajitel\w*|\bsprávc\w*"
    r"|\bpřístup\w*\b(?!\s+ke?\s+(?!admin|správ|systém|web|stránk|účt|nastaven|pravid|instrukc"
    r"|dat|konverzac|rozhovor|poznám|soukrom|intern|profil))",
    re.IGNORECASE,
)
#: A change of the assistant's rules or instructions, or its system instructions themselves.
_RULE_CHANGE: Final = re.compile(
    r"\b(?:ignor|skip|bypass|overrid|chang|forget|forgot|break|relax|lift|disabl|suspend)\w*\b"
    r".{0,40}?\b(?:rules?|instructions?|guidelines|restrictions?|prompts?)\b"
    r"|\b(?:rules?|instructions?|restrictions?)\b.{0,30}?"
    r"\b(?:skipped|ignored|changed|lifted|overridden|bypassed|suspended|relaxed)\b"
    r"|\bsystem\s+(?:prompts?|instructions?|notes?|messages?)\b"
    r"|\b(?:your|its|the\s+assistant'?s?)\s+(?:own\s+)?(?:rules|instructions|prompt)\b"
    r"|\bsystémov\w*\s+(?:instrukc|pokyn|prompt|zpráv|poznám)\w*"
    r"|\b(?:změn|ignor|zapom|přeskoč|obejít|obejd|obcház|zruš|poruš|vypn)\w*\b"
    r".{0,40}?\b(?:pravid|instrukc|pokyn|omezen)\w*"
    r"|\b(?:pravid|instrukc|pokyn)\w*\b.{0,30}?\b(?:změn|ignor|zapom|přeskoč|zruš|poruš)\w*"
    r"|\b(?:svá|své|svých|svým|jeho|jejich|asistent\w*)\s+(?:pravid|instrukc)\w*",
    re.IGNORECASE,
)
#: That the assistant declined, the one rule-change line `covered` may keep.
_DECLINED: Final = re.compile(r"\b(?:declin|refus|odmít|odmítl)\w*", re.IGNORECASE)
#: A goal that presupposes a fact: a verb of learning or confirming followed directly by "that" or
#: "že" ("Learn that …", "Zjistit, že …"), where an open question asks "which" or "whether".
_PRESUPPOSED: Final = re.compile(
    r"\b(?:learn|find\s+out|confirm|verify|check|establish|hear|discover|understand|know"
    r"|be\s+told|get\s+confirmation)\s*,?\s+that\b"
    r"|\b(?:zjistit|zjišťovat|ověřit|ověřovat|potvrdit|potvrzovat|dozvědět|slyšet|zkontrolovat"
    r"|pochopit|vědět)(?:\s+(?:si|se))?\s*,?\s*že\b",
    re.IGNORECASE,
)


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
    filled = _guarded(summary).model_copy(update={"references": tuple(references)})
    if summary_tokens(filled) > SUMMARY_TOKEN_CAP:
        return None
    return filled


def _guarded(summary: ContextSummary) -> ContextSummary:
    """`summary` without the goal, open-question and covered lines that name claimed authority,
    and without the goal and open-question lines that presuppose a fact."""

    def kept(line: str, *, declined_rule_change: bool) -> bool:
        if _AUTHORITY.search(line):
            return False
        if _RULE_CHANGE.search(line):
            return declined_rule_change and _DECLINED.search(line) is not None
        return True

    def open_question(line: str) -> bool:
        return kept(line, declined_rule_change=False) and _PRESUPPOSED.search(line) is None

    return summary.model_copy(
        update={
            "goals": tuple(line for line in summary.goals if open_question(line)),
            "open_questions": tuple(line for line in summary.open_questions if open_question(line)),
            "covered": tuple(
                line for line in summary.covered if kept(line, declined_rule_change=True)
            ),
        }
    )
