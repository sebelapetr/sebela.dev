from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatGenerationResultUsage")


@_attrs_define
class ChatGenerationResultUsage:
    """
    Attributes:
        cost_usd (float):
        cost_uncertain (bool):
        input_tokens (int):
        output_tokens (int):
        model_attempts (int):
    """

    cost_usd: float
    cost_uncertain: bool
    input_tokens: int
    output_tokens: int
    model_attempts: int

    def to_dict(self) -> dict[str, Any]:
        cost_usd = self.cost_usd

        cost_uncertain = self.cost_uncertain

        input_tokens = self.input_tokens

        output_tokens = self.output_tokens

        model_attempts = self.model_attempts

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "costUsd": cost_usd,
                "costUncertain": cost_uncertain,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "modelAttempts": model_attempts,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        cost_usd = d.pop("costUsd")

        cost_uncertain = d.pop("costUncertain")

        input_tokens = d.pop("inputTokens")

        output_tokens = d.pop("outputTokens")

        model_attempts = d.pop("modelAttempts")

        chat_generation_result_usage = cls(
            cost_usd=cost_usd,
            cost_uncertain=cost_uncertain,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model_attempts=model_attempts,
        )

        return chat_generation_result_usage
