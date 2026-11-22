from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="AuditChangeActor")


@_attrs_define
class AuditChangeActor:
    """
    Attributes:
        key_id (UUID):
        key_name (str):
    """

    key_id: UUID
    key_name: str

    def to_dict(self) -> dict[str, Any]:
        key_id = str(self.key_id)

        key_name = self.key_name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "keyId": key_id,
                "keyName": key_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        key_id = UUID(d.pop("keyId"))

        key_name = d.pop("keyName")

        audit_change_actor = cls(
            key_id=key_id,
            key_name=key_name,
        )

        return audit_change_actor
