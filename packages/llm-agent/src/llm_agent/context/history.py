"""The caller-supplied conversation as bounded, untrusted model context.

The package stores no conversation and summarizes nothing: the caller passes the earlier exchanges
with every request. `select_history` keeps the newest complete exchanges that fit the exchange and
token caps (an exchange is never cut, and an exchange that does not fit hides every older one, so
the context stays contiguous). `history_block` renders them as delimited visitor data: every tag
of the block is a `visitor_` tag and every text is neutralized, so an earlier answer can neither
close the block nor pose as instructions.
"""

from __future__ import annotations

from collections.abc import Sequence

from llm_agent.context.tokens import text_tokens
from llm_agent.guardrails.input import neutralized
from llm_agent.schemas import ChatExchange


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


def history_block(exchanges: Sequence[ChatExchange]) -> str:
    """The exchanges as untrusted, delimited visitor data; empty when there are none."""
    if not exchanges:
        return ""
    return (
        "<visitor_history>\n"
        + "".join(_exchange(item) for item in exchanges)
        + "</visitor_history>"
    )


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
