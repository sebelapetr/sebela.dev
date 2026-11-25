from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.chat_operation import ChatOperation


T = TypeVar("T", bound="ChatCompactionStarted")


@_attrs_define
class ChatCompactionStarted:
    """
    Attributes:
        status (Literal['started']):
        operation (ChatOperation):
    """

    status: Literal["started"]
    operation: ChatOperation

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        operation = self.operation.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "operation": operation,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_operation import ChatOperation

        d = dict(src_dict)
        status = cast(Literal["started"], d.pop("status"))
        if status != "started":
            raise ValueError(f"status must match const 'started', got '{status}'")

        operation = ChatOperation.from_dict(d.pop("operation"))

        chat_compaction_started = cls(
            status=status,
            operation=operation,
        )

        return chat_compaction_started
