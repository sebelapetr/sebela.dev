from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatGenerationResultContextType0")


@_attrs_define
class ChatGenerationResultContextType0:
    """
    Attributes:
        estimated_input_tokens (int):
        reported_input_tokens (int | None):
        cap_tokens (int):
    """

    estimated_input_tokens: int
    reported_input_tokens: int | None
    cap_tokens: int

    def to_dict(self) -> dict[str, Any]:
        estimated_input_tokens = self.estimated_input_tokens

        reported_input_tokens: int | None
        reported_input_tokens = self.reported_input_tokens

        cap_tokens = self.cap_tokens

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "estimatedInputTokens": estimated_input_tokens,
                "reportedInputTokens": reported_input_tokens,
                "capTokens": cap_tokens,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        estimated_input_tokens = d.pop("estimatedInputTokens")

        def _parse_reported_input_tokens(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        reported_input_tokens = _parse_reported_input_tokens(
            d.pop("reportedInputTokens")
        )

        cap_tokens = d.pop("capTokens")

        chat_generation_result_context_type_0 = cls(
            estimated_input_tokens=estimated_input_tokens,
            reported_input_tokens=reported_input_tokens,
            cap_tokens=cap_tokens,
        )

        return chat_generation_result_context_type_0
