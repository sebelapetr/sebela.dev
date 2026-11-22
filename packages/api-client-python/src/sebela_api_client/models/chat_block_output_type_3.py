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

from ..models.chat_block_output_type_3_status import ChatBlockOutputType3Status

T = TypeVar("T", bound="ChatBlockOutputType3")


@_attrs_define
class ChatBlockOutputType3:
    """
    Attributes:
        type_ (Literal['ExplorationCard']):
        title (str):
        summary (None | str):
        status (ChatBlockOutputType3Status): The exploration's stored status; never shown stronger than stored.
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    type_: Literal["ExplorationCard"]
    title: str
    summary: None | str
    status: ChatBlockOutputType3Status
    href: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        summary: None | str
        summary = self.summary

        status = self.status.value

        href = self.href

        field_dict: dict[str, Any] = {}

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

        status = ChatBlockOutputType3Status(d.pop("status"))

        href = d.pop("href")

        chat_block_output_type_3 = cls(
            type_=type_,
            title=title,
            summary=summary,
            status=status,
            href=href,
        )

        return chat_block_output_type_3
