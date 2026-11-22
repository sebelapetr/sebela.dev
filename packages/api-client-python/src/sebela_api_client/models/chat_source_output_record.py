from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.chat_source_output_record_kind import ChatSourceOutputRecordKind

T = TypeVar("T", bound="ChatSourceOutputRecord")


@_attrs_define
class ChatSourceOutputRecord:
    """
    Attributes:
        kind (ChatSourceOutputRecordKind):
        id (str):
    """

    kind: ChatSourceOutputRecordKind
    id: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        id = self.id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "id": id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        kind = ChatSourceOutputRecordKind(d.pop("kind"))

        id = d.pop("id")

        chat_source_output_record = cls(
            kind=kind,
            id=id,
        )

        return chat_source_output_record
