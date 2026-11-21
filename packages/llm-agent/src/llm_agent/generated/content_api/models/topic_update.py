from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="TopicUpdate")


@_attrs_define
class TopicUpdate:
    """
    Attributes:
        name (str | Unset):
        position (int | Unset): Ascending order in the list; ties are ordered by slug.
    """

    name: str | Unset = UNSET
    position: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if position is not UNSET:
            field_dict["position"] = position

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        position = d.pop("position", UNSET)

        topic_update = cls(
            name=name,
            position=position,
        )

        return topic_update
