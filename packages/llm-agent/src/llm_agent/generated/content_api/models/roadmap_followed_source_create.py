from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapFollowedSourceCreate")


@_attrs_define
class RoadmapFollowedSourceCreate:
    """
    Attributes:
        slug (str): The stable identity of the record and its anchor on the website.
        title (str):
        kind (str): A short label of what the source is, for example `newsletter`, `podcast` or `blog`; free text, shown
            as written.
        position (int): Ascending order in its list; ties are ordered by slug.
        description (None | str | Unset): Markdown; `null` when there is none.
        link (None | str | Unset): An absolute `http` or `https` address; `null` when there is none.
    """

    slug: str
    title: str
    kind: str
    position: int
    description: None | str | Unset = UNSET
    link: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        title = self.title

        kind = self.kind

        position = self.position

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        link: None | str | Unset
        if isinstance(self.link, Unset):
            link = UNSET
        else:
            link = self.link

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "title": title,
                "kind": kind,
                "position": position,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if link is not UNSET:
            field_dict["link"] = link

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        title = d.pop("title")

        kind = d.pop("kind")

        position = d.pop("position")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_link(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        link = _parse_link(d.pop("link", UNSET))

        roadmap_followed_source_create = cls(
            slug=slug,
            title=title,
            kind=kind,
            position=position,
            description=description,
            link=link,
        )

        return roadmap_followed_source_create
