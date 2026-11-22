from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapAreaCreate")


@_attrs_define
class RoadmapAreaCreate:
    """
    Attributes:
        slug (str): The stable address of the area; never diary, bookshelf, events, how-to-read-effectively.
        name (str):
        weight (int): The recommended share of learning effort, 1 to 100. It is not progress and not logged time.
        position (int): Ascending order among its siblings; ties are ordered by slug.
        description (None | str | Unset): Markdown; `null` when there is none.
    """

    slug: str
    name: str
    weight: int
    position: int
    description: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        weight = self.weight

        position = self.position

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "weight": weight,
                "position": position,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        weight = d.pop("weight")

        position = d.pop("position")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        roadmap_area_create = cls(
            slug=slug,
            name=name,
            weight=weight,
            position=position,
            description=description,
        )

        return roadmap_area_create
