from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapModuleUpdate")


@_attrs_define
class RoadmapModuleUpdate:
    """
    Attributes:
        area (str | Unset): The slug of an existing area.
        name (str | Unset):
        description (None | str | Unset): Markdown; `null` when there is none.
        position (int | Unset): Ascending order among its siblings; ties are ordered by slug.
    """

    area: str | Unset = UNSET
    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    position: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        area = self.area

        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if area is not UNSET:
            field_dict["area"] = area
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if position is not UNSET:
            field_dict["position"] = position

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        area = d.pop("area", UNSET)

        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        position = d.pop("position", UNSET)

        roadmap_module_update = cls(
            area=area,
            name=name,
            description=description,
            position=position,
        )

        return roadmap_module_update
