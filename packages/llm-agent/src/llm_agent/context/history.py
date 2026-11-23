"""The caller-supplied working context as bounded, untrusted model context.

The package stores no conversation: the caller passes the earlier exchanges with every request and,
after a compaction (`context/compact.py`), the one summary installed for the exchanges before them.
`select_context` keeps the newest complete exchanges that fit the exchange and token caps (an
exchange is never cut, and an exchange that does not fit hides every older one, so the context
stays contiguous); the summary is the oldest part of the context, so it is shown only when every
exchange is and it still fits, and it is the first thing dropped. `history_block` renders them as
delimited visitor data: every tag of the block is a `visitor_` tag and every text is neutralized,
so an earlier answer or a summary line can neither close the block nor pose as instructions.
"""

from __future__ import annotations

from collections.abc import Sequence

from llm_agent.context.tokens import text_tokens
from llm_agent.guardrails.input import neutralized
from llm_agent.schemas import ChatExchange, ContextSummary


def select_context(
    history: Sequence[ChatExchange],
    summary: ContextSummary | None,
    *,
    max_exchanges: int,
    max_tokens: int,
) -> tuple[ContextSummary | None, tuple[ChatExchange, ...]]:
    """The summary (when it still fits behind every exchange) and the newest contiguous complete
    exchanges within both caps, oldest first. The summary does not count as an exchange."""
    selected = select_history(history, max_exchanges=max_exchanges, max_tokens=max_tokens)
    if summary is None or len(selected) < len(history):
        return None, selected
    if text_tokens(history_block(selected, summary=summary)) > max_tokens:
        return None, selected
    return summary, selected


def select_history(
    history: Sequence[ChatExchange], *, max_exchanges: int, max_tokens: int
) -> tuple[ChatExchange, ...]:
    """The newest contiguous complete exchanges within both caps, oldest first."""
    selected: list[ChatExchange] = []
    for exchange in reversed(history):
        if len(selected) >= max_exchanges:
            break
        candidate = [exchange, *selected]
        if text_tokens(history_block(candidate)) > max_tokens:
            break
        selected = candidate
    return tuple(selected)


def history_block(
    exchanges: Sequence[ChatExchange], *, summary: ContextSummary | None = None
) -> str:
    """The summary and exchanges as untrusted, delimited visitor data; empty when there are none.

    Without a summary the block is exactly what it was before compaction existed.
    """
    if not exchanges and summary is None:
        return ""
    opening = summary_block(summary) if summary is not None else ""
    return (
        "<visitor_history>\n"
        + opening
        + "".join(_exchange(item) for item in exchanges)
        + "</visitor_history>"
    )


def summary_block(summary: ContextSummary) -> str:
    """One summary as delimited visitor data, the first element of a history block."""
    lists = "".join(
        _lines(name, items)
        for name, items in (
            ("goals", summary.goals),
            ("open_questions", summary.open_questions),
            ("covered", summary.covered),
            ("visitor_claims", summary.visitor_claims),
        )
    )
    references = "".join(
        f'- {item.kind}:{neutralized(item.record_id)} "{neutralized(item.title)}"\n'
        for item in summary.references
    )
    shown = (
        f"<visitor_summary_references>\n{references}</visitor_summary_references>\n"
        if references
        else ""
    )
    return (
        "<visitor_summary>\n"
        f"<visitor_summary_language>{summary.language}</visitor_summary_language>\n"
        f"{lists}{shown}"
        "</visitor_summary>\n"
    )


def _lines(name: str, items: Sequence[str]) -> str:
    if not items:
        return ""
    body = "".join(f"- {neutralized(item)}\n" for item in items)
    return f"<visitor_summary_{name}>\n{body}</visitor_summary_{name}>\n"


def _exchange(exchange: ChatExchange) -> str:
    sources = "".join(
        f'- {source.kind}:{neutralized(source.record_id)} "{neutralized(source.title)}"\n'
        for source in exchange.sources
    )
    shown = f"<visitor_turn_sources>\n{sources}</visitor_turn_sources>\n" if sources else ""
    return (
        "<visitor_exchange>\n"
        f"<visitor_turn_language>{exchange.language}</visitor_turn_language>\n"
        f"<visitor_turn_question>\n{neutralized(exchange.question)}\n</visitor_turn_question>\n"
        f"<visitor_turn_answer>\n{neutralized(exchange.answer)}\n</visitor_turn_answer>\n"
        f"{shown}"
        "</visitor_exchange>\n"
    )
