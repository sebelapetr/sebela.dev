from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RoadmapGlossaryTermCreate")


@_attrs_define
class RoadmapGlossaryTermCreate:
    """
    Attributes:
        slug (str): The stable identity of the record and its anchor on the website.
        term (str):
        description (str): What the term means, Markdown.
        position (int): Ascending order in its list; ties are ordered by slug.
    """

    slug: str
    term: str
    description: str
    position: int

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        term = self.term

        description = self.description

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "term": term,
                "description": description,
                "position": position,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        term = d.pop("term")

        description = d.pop("description")

        position = d.pop("position")

        roadmap_glossary_term_create = cls(
            slug=slug,
            term=term,
            description=description,
            position=position,
        )

        return roadmap_glossary_term_create
