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

T = TypeVar("T", bound="ChatBlockOutputType4")


@_attrs_define
class ChatBlockOutputType4:
    """
    Attributes:
        type_ (Literal['RoadmapCard']):
        title (str):
        summary (None | str):
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    type_: Literal["RoadmapCard"]
    title: str
    summary: None | str
    href: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        summary: None | str
        summary = self.summary

        href = self.href

        field_dict: dict[str, Any] = {}

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
        type_ = cast(Literal["RoadmapCard"], d.pop("type"))
        if type_ != "RoadmapCard":
            raise ValueError(f"type must match const 'RoadmapCard', got '{type_}'")

        title = d.pop("title")

        def _parse_summary(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        summary = _parse_summary(d.pop("summary"))

        href = d.pop("href")

        chat_block_output_type_4 = cls(
            type_=type_,
            title=title,
            summary=summary,
            href=href,
        )

        return chat_block_output_type_4
