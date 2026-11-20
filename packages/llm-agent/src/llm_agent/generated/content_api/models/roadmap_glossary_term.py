from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="RoadmapGlossaryTerm")


@_attrs_define
class RoadmapGlossaryTerm:
    """
    Attributes:
        id (UUID):
        slug (str): The stable identity of the record and its anchor on the website.
        term (str):
        description (str): What the term means, Markdown.
        position (int): Ascending order in its list; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    term: str
    description: str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        term = self.term

        description = self.description

        position = self.position

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "term": term,
                "description": description,
                "position": position,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        term = d.pop("term")

        description = d.pop("description")

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_glossary_term = cls(
            id=id,
            slug=slug,
            term=term,
            description=description,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_glossary_term
