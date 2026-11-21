"""The validated stage configuration: model IDs, effort and prices; never visitor-controlled.

Prices are the checked Haiku 5.5 short-context rates (USD per million tokens, 2026-11-19). A model
or price change updates this file, the versions it produces and the affected evals together.
"""

from __future__ import annotations

from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field

Stage = Literal["security", "main"]
Effort = Literal["low", "medium", "high"]

HAIKU: Final = "claude-haiku-5-5"
#: The checked price list the stage prices come from; part of the stored versions.
PRICING_VERSION: Final = "anthropic-2026-11-19"
SECURITY_EFFORT: Final = "medium"
MAIN_EFFORT: Final = "medium"


class Prices(BaseModel):
    """USD per million tokens."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input: float = Field(gt=0)
    output: float = Field(gt=0)
    cache_read: float = Field(gt=0)
    cache_write: float = Field(gt=0)


class StageModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)
    effort: Effort
    prices: Prices


HAIKU_PRICES = Prices(input=0.10, output=0.50, cache_read=0.01, cache_write=0.125)

STAGES: Final[dict[Stage, StageModel]] = {
    "security": StageModel(model=HAIKU, effort=SECURITY_EFFORT, prices=HAIKU_PRICES),
    "main": StageModel(model=HAIKU, effort=MAIN_EFFORT, prices=HAIKU_PRICES),
}
