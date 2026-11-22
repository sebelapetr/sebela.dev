from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapGlossaryTermUpdate")


@_attrs_define
class RoadmapGlossaryTermUpdate:
    """
    Attributes:
        term (str | Unset):
        description (str | Unset): What the term means, Markdown.
        position (int | Unset): Ascending order in its list; ties are ordered by slug.
    """

    term: str | Unset = UNSET
    description: str | Unset = UNSET
    position: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        term = self.term

        description = self.description

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if term is not UNSET:
            field_dict["term"] = term
        if description is not UNSET:
            field_dict["description"] = description
        if position is not UNSET:
            field_dict["position"] = position

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        term = d.pop("term", UNSET)

        description = d.pop("description", UNSET)

        position = d.pop("position", UNSET)

        roadmap_glossary_term_update = cls(
            term=term,
            description=description,
            position=position,
        )

        return roadmap_glossary_term_update
