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

from ..models.chat_block_type_3_status import ChatBlockType3Status

T = TypeVar("T", bound="ChatBlockType3")


@_attrs_define
class ChatBlockType3:
    """
    Attributes:
        type_ (Literal['ExplorationCard']):
        title (str):
        summary (None | str):
        status (ChatBlockType3Status): The exploration's stored status; never shown stronger than stored.
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    type_: Literal["ExplorationCard"]
    title: str
    summary: None | str
    status: ChatBlockType3Status
    href: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        summary: None | str
        summary = self.summary

        status = self.status.value

        href = self.href

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "title": title,
                "summary": summary,
                "status": status,
                "href": href,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        type_ = cast(Literal["ExplorationCard"], d.pop("type"))
        if type_ != "ExplorationCard":
            raise ValueError(f"type must match const 'ExplorationCard', got '{type_}'")

        title = d.pop("title")

        def _parse_summary(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        summary = _parse_summary(d.pop("summary"))

        status = ChatBlockType3Status(d.pop("status"))

        href = d.pop("href")

        chat_block_type_3 = cls(
            type_=type_,
            title=title,
            summary=summary,
            status=status,
            href=href,
        )

        chat_block_type_3.additional_properties = d
        return chat_block_type_3

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
