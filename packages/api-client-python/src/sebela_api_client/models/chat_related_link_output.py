from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatRelatedLinkOutput")


@_attrs_define
class ChatRelatedLinkOutput:
    """
    Attributes:
        label (str):
        href (str):
    """

    label: str
    href: str

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        href: str
        href = self.href

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "href": href,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        label = d.pop("label")

        def _parse_href(data: object) -> str:
            return cast(str, data)

        href = _parse_href(d.pop("href"))

        chat_related_link_output = cls(
            label=label,
            href=href,
        )

        return chat_related_link_output
