from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatUsageContextType0")


@_attrs_define
class ChatUsageContextType0:
    """
    Attributes:
        status (Literal['measured']):
        operation_id (UUID):
        measured_at (datetime.datetime):
        estimated_input_tokens (int): The tokenizer estimate of the last main call's serialized input.
        reported_input_tokens (int | None): The input tokens the provider reported for that call; `null` if none.
        cap_tokens (int): The input-token cap that call was sent under.
    """

    status: Literal["measured"]
    operation_id: UUID
    measured_at: datetime.datetime
    estimated_input_tokens: int
    reported_input_tokens: int | None
    cap_tokens: int

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        operation_id = str(self.operation_id)

        measured_at = self.measured_at.isoformat()

        estimated_input_tokens = self.estimated_input_tokens

        reported_input_tokens: int | None
        reported_input_tokens = self.reported_input_tokens

        cap_tokens = self.cap_tokens

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "operationId": operation_id,
                "measuredAt": measured_at,
                "estimatedInputTokens": estimated_input_tokens,
                "reportedInputTokens": reported_input_tokens,
                "capTokens": cap_tokens,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        status = cast(Literal["measured"], d.pop("status"))
        if status != "measured":
            raise ValueError(f"status must match const 'measured', got '{status}'")

        operation_id = UUID(d.pop("operationId"))

        measured_at = datetime.datetime.fromisoformat(d.pop("measuredAt"))

        estimated_input_tokens = d.pop("estimatedInputTokens")

        def _parse_reported_input_tokens(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        reported_input_tokens = _parse_reported_input_tokens(
            d.pop("reportedInputTokens")
        )

        cap_tokens = d.pop("capTokens")

        chat_usage_context_type_0 = cls(
            status=status,
            operation_id=operation_id,
            measured_at=measured_at,
            estimated_input_tokens=estimated_input_tokens,
            reported_input_tokens=reported_input_tokens,
            cap_tokens=cap_tokens,
        )

        return chat_usage_context_type_0
