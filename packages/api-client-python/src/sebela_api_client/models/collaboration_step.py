from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CollaborationStep")


@_attrs_define
class CollaborationStep:
    """One step of how the person works with a client, in its intended order.

    Attributes:
        title (str):
        description (str): Markdown.
    """

    title: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "title": title,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title")

        description = d.pop("description")

        collaboration_step = cls(
            title=title,
            description=description,
        )

        return collaboration_step
