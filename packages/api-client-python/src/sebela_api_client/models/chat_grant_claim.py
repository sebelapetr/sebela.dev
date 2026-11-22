from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatGrantClaim")


@_attrs_define
class ChatGrantClaim:
    """
    Attributes:
        operation_id (UUID):
        grant (str):
    """

    operation_id: UUID
    grant: str

    def to_dict(self) -> dict[str, Any]:
        operation_id = str(self.operation_id)

        grant = self.grant

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "operationId": operation_id,
                "grant": grant,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        operation_id = UUID(d.pop("operationId"))

        grant = d.pop("grant")

        chat_grant_claim = cls(
            operation_id=operation_id,
            grant=grant,
        )

        return chat_grant_claim
