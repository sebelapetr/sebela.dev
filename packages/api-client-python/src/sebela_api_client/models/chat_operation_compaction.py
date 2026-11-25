from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.chat_operation_compaction_outcome import ChatOperationCompactionOutcome

T = TypeVar("T", bound="ChatOperationCompaction")


@_attrs_define
class ChatOperationCompaction:
    """
    Attributes:
        outcome (ChatOperationCompactionOutcome):
        reason (None | str):
    """

    outcome: ChatOperationCompactionOutcome
    reason: None | str

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome.value

        reason: None | str
        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "outcome": outcome,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        outcome = ChatOperationCompactionOutcome(d.pop("outcome"))

        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))

        chat_operation_compaction = cls(
            outcome=outcome,
            reason=reason,
        )

        return chat_operation_compaction
