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
from attrs import field as _attrs_field

T = TypeVar("T", bound="ChatBlockType2")


@_attrs_define
class ChatBlockType2:
    """
    Attributes:
        type_ (Literal['ServiceCard']):
        title (str):
        summary (str):
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    type_: Literal["ServiceCard"]
    title: str
    summary: str
    href: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        summary = self.summary

        href = self.href

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "title": title,
                "summary": summary,
                "href": href,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        type_ = cast(Literal["ServiceCard"], d.pop("type"))
        if type_ != "ServiceCard":
            raise ValueError(f"type must match const 'ServiceCard', got '{type_}'")

        title = d.pop("title")

        summary = d.pop("summary")

        href = d.pop("href")

        chat_block_type_2 = cls(
            type_=type_,
            title=title,
            summary=summary,
            href=href,
        )

        chat_block_type_2.additional_properties = d
        return chat_block_type_2

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
