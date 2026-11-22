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

T = TypeVar("T", bound="ChatUsageContextType1")


@_attrs_define
class ChatUsageContextType1:
    """
    Attributes:
        status (Literal['unavailable']):
    """

    status: Literal["unavailable"]

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        status = cast(Literal["unavailable"], d.pop("status"))
        if status != "unavailable":
            raise ValueError(f"status must match const 'unavailable', got '{status}'")

        chat_usage_context_type_1 = cls(
            status=status,
        )

        return chat_usage_context_type_1
