"""Normalizes provider usage of one model attempt and prices it."""

from __future__ import annotations

from dataclasses import dataclass

from langchain_core.messages import BaseMessage

from llm_agent.models.config import Prices


@dataclass(frozen=True)
class MeasuredUsage:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0

    def cost_usd(self, prices: Prices) -> float:
        uncached = max(self.input_tokens - self.cache_read_tokens - self.cache_creation_tokens, 0)
        return (
            uncached * prices.input
            + self.cache_read_tokens * prices.cache_read
            + self.cache_creation_tokens * prices.cache_write
            + self.output_tokens * prices.output
        ) / 1_000_000


def measured(message: BaseMessage) -> MeasuredUsage | None:
    """The usage the provider reported, or None when it reported none."""
    metadata = getattr(message, "usage_metadata", None)
    if not metadata:
        return None
    details = metadata.get("input_token_details") or {}
    return MeasuredUsage(
        input_tokens=int(metadata.get("input_tokens", 0)),
        output_tokens=int(metadata.get("output_tokens", 0)),
        cache_read_tokens=int(details.get("cache_read", 0) or 0),
        cache_creation_tokens=int(details.get("cache_creation", 0) or 0),
    )


def estimated_cost_usd(input_tokens: int, output_tokens: int, prices: Prices) -> float:
    """The conservative price of an attempt: no cache discount, the whole output cap."""
    return (input_tokens * prices.input + output_tokens * prices.output) / 1_000_000
