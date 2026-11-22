from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatCompactionNoop")


@_attrs_define
class ChatCompactionNoop:
    """
    Attributes:
        status (Literal['noop']):
        reason (Literal['nothing_to_compact']): The working context is already small; nothing was billed or counted.
    """

    status: Literal["noop"]
    reason: Literal["nothing_to_compact"]

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        status = cast(Literal["noop"], d.pop("status"))
        if status != "noop":
            raise ValueError(f"status must match const 'noop', got '{status}'")

        reason = cast(Literal["nothing_to_compact"], d.pop("reason"))
        if reason != "nothing_to_compact":
            raise ValueError(
                f"reason must match const 'nothing_to_compact', got '{reason}'"
            )

        chat_compaction_noop = cls(
            status=status,
            reason=reason,
        )

        return chat_compaction_noop
