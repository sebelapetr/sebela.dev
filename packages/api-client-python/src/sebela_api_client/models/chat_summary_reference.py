from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.chat_summary_reference_kind import ChatSummaryReferenceKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="ChatSummaryReference")


@_attrs_define
class ChatSummaryReference:
    """
    Attributes:
        kind (ChatSummaryReferenceKind):
        record_id (str):
        title (str | Unset):  Default: ''.
    """

    kind: ChatSummaryReferenceKind
    record_id: str
    title: str | Unset = ""

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        record_id = self.record_id

        title = self.title

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "recordId": record_id,
            }
        )
        if title is not UNSET:
            field_dict["title"] = title

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        kind = ChatSummaryReferenceKind(d.pop("kind"))

        record_id = d.pop("recordId")

        title = d.pop("title", UNSET)

        chat_summary_reference = cls(
            kind=kind,
            record_id=record_id,
            title=title,
        )

        return chat_summary_reference
