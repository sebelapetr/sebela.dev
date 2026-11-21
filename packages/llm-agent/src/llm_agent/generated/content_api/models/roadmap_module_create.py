from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapModuleCreate")


@_attrs_define
class RoadmapModuleCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        area (str): The slug of an existing area.
        name (str):
        position (int): Ascending order among its siblings; ties are ordered by slug.
        description (None | str | Unset): Markdown; `null` when there is none.
    """

    slug: str
    area: str
    name: str
    position: int
    description: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        area = self.area

        name = self.name

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
                "area": area,
                "name": name,
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

        area = d.pop("area")

        name = d.pop("name")

        position = d.pop("position")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        roadmap_module_create = cls(
            slug=slug,
            area=area,
            name=name,
            position=position,
            description=description,
        )

        return roadmap_module_create
