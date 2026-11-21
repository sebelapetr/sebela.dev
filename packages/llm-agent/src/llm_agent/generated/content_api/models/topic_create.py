from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="TopicCreate")


@_attrs_define
class TopicCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        position (int): Ascending order in the list; ties are ordered by slug.
    """

    slug: str
    name: str
    position: int

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "position": position,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        position = d.pop("position")

        topic_create = cls(
            slug=slug,
            name=name,
            position=position,
        )

        return topic_create
