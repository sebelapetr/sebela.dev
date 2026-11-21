from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CurrentFocusCreate")


@_attrs_define
class CurrentFocusCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        title (str): What is being worked on or learned now.
        description (str): Markdown.
        position (int): Ascending order in the list; ties are ordered by slug.
        link (None | str | Unset): An absolute `http` or `https` address with more about the focus; `null` when there is
            none.
        project (None | str | Unset): The slug of an existing project the focus is about, or `null` for none. On an
            update a slug replaces the project, `null` removes it and an omitted field keeps it.
        topics (list[str] | Unset): Slugs of existing topics, each once, in their intended order. On an update the list
            replaces every link (an empty list removes them); an omitted list leaves them unchanged.
    """

    slug: str
    title: str
    description: str
    position: int
    link: None | str | Unset = UNSET
    project: None | str | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        title = self.title

        description = self.description

        position = self.position

        link: None | str | Unset
        if isinstance(self.link, Unset):
            link = UNSET
        else:
            link = self.link

        project: None | str | Unset
        if isinstance(self.project, Unset):
            project = UNSET
        else:
            project = self.project

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "title": title,
                "description": description,
                "position": position,
            }
        )
        if link is not UNSET:
            field_dict["link"] = link
        if project is not UNSET:
            field_dict["project"] = project
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        title = d.pop("title")

        description = d.pop("description")

        position = d.pop("position")

        def _parse_link(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        link = _parse_link(d.pop("link", UNSET))

        def _parse_project(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        project = _parse_project(d.pop("project", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        current_focus_create = cls(
            slug=slug,
            title=title,
            description=description,
            position=position,
            link=link,
            project=project,
            topics=topics,
        )

        return current_focus_create
