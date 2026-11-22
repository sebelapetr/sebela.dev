from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.chat_source_output_record import ChatSourceOutputRecord


T = TypeVar("T", bound="ChatSourceOutput")


@_attrs_define
class ChatSourceOutput:
    """
    Attributes:
        record (ChatSourceOutputRecord):
        title (str):
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    record: ChatSourceOutputRecord
    title: str
    href: str

    def to_dict(self) -> dict[str, Any]:
        record = self.record.to_dict()

        title = self.title

        href = self.href

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "record": record,
                "title": title,
                "href": href,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_source_output_record import ChatSourceOutputRecord

        d = dict(src_dict)
        record = ChatSourceOutputRecord.from_dict(d.pop("record"))

        title = d.pop("title")

        href = d.pop("href")

        chat_source_output = cls(
            record=record,
            title=title,
            href=href,
        )

        return chat_source_output
