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

T = TypeVar("T", bound="ChatUsageNextRequestType0")


@_attrs_define
class ChatUsageNextRequestType0:
    """
    Attributes:
        status (Literal['estimated']):
        history_tokens (int): The estimated tokens of the working context after the compaction: the summary and the kept
            exchanges, never the question, the instructions or tool results.
        operation_id (UUID): The compaction that measured it.
        measured_at (datetime.datetime):
    """

    status: Literal["estimated"]
    history_tokens: int
    operation_id: UUID
    measured_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        history_tokens = self.history_tokens

        operation_id = str(self.operation_id)

        measured_at = self.measured_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "historyTokens": history_tokens,
                "operationId": operation_id,
                "measuredAt": measured_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        status = cast(Literal["estimated"], d.pop("status"))
        if status != "estimated":
            raise ValueError(f"status must match const 'estimated', got '{status}'")

        history_tokens = d.pop("historyTokens")

        operation_id = UUID(d.pop("operationId"))

        measured_at = datetime.datetime.fromisoformat(d.pop("measuredAt"))

        chat_usage_next_request_type_0 = cls(
            status=status,
            history_tokens=history_tokens,
            operation_id=operation_id,
            measured_at=measured_at,
        )

        return chat_usage_next_request_type_0
