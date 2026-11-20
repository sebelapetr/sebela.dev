from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapAreaUpdate")


@_attrs_define
class RoadmapAreaUpdate:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset): Markdown; `null` when there is none.
        weight (int | Unset): The recommended share of learning effort, 1 to 100. It is not progress and not logged
            time.
        position (int | Unset): Ascending order among its siblings; ties are ordered by slug.
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    weight: int | Unset = UNSET
    position: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        weight = self.weight

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if weight is not UNSET:
            field_dict["weight"] = weight
        if position is not UNSET:
            field_dict["position"] = position

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        weight = d.pop("weight", UNSET)

        position = d.pop("position", UNSET)

        roadmap_area_update = cls(
            name=name,
            description=description,
            weight=weight,
            position=position,
        )

        return roadmap_area_update
