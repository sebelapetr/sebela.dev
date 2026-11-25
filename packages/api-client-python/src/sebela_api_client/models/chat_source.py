from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.chat_source_record import ChatSourceRecord


T = TypeVar("T", bound="ChatSource")


@_attrs_define
class ChatSource:
    """
    Attributes:
        record (ChatSourceRecord):
        title (str):
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    record: ChatSourceRecord
    title: str
    href: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        record = self.record.to_dict()

        title = self.title

        href = self.href

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.chat_source_record import ChatSourceRecord

        d = dict(src_dict)
        record = ChatSourceRecord.from_dict(d.pop("record"))

        title = d.pop("title")

        href = d.pop("href")

        chat_source = cls(
            record=record,
            title=title,
            href=href,
        )

        chat_source.additional_properties = d
        return chat_source

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
