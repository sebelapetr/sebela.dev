from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="RoadmapFollowedSource")


@_attrs_define
class RoadmapFollowedSource:
    """
    Attributes:
        id (UUID):
        slug (str): The stable identity of the record and its anchor on the website.
        title (str):
        description (None | str): Markdown; `null` when there is none.
        link (None | str): An absolute `http` or `https` address; `null` when there is none.
        kind (str): A short label of what the source is, for example `newsletter`, `podcast` or `blog`; free text, shown
            as written.
        position (int): Ascending order in its list; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    title: str
    description: None | str
    link: None | str
    kind: str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        title = self.title

        description: None | str
        description = self.description

        link: None | str
        link = self.link

        kind = self.kind

        position = self.position

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "title": title,
                "description": description,
                "link": link,
                "kind": kind,
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

        title = d.pop("title")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        def _parse_link(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        link = _parse_link(d.pop("link"))

        kind = d.pop("kind")

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_followed_source = cls(
            id=id,
            slug=slug,
            title=title,
            description=description,
            link=link,
            kind=kind,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_followed_source
