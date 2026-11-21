from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.current_focus_project import CurrentFocusProject
    from ..models.topic import Topic


T = TypeVar("T", bound="CurrentFocus")


@_attrs_define
class CurrentFocus:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `paldock`.
        title (str): What is being worked on or learned now.
        description (str): Markdown.
        link (None | str): An absolute `http` or `https` address with more about the focus; `null` when there is none.
        position (int): Ascending order in the list; ties are ordered by slug.
        project (CurrentFocusProject | None): The project the focus is about, or `null` when it is about none.
        topics (list[Topic]): The linked topics, in their intended order.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    title: str
    description: str
    link: None | str
    position: int
    project: CurrentFocusProject | None
    topics: list[Topic]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.current_focus_project import CurrentFocusProject

        id = str(self.id)

        slug = self.slug

        title = self.title

        description = self.description

        link: None | str
        link = self.link

        position = self.position

        project: dict[str, Any] | None
        if isinstance(self.project, CurrentFocusProject):
            project = self.project.to_dict()
        else:
            project = self.project

        topics = []
        for topics_item_data in self.topics:
            topics_item = topics_item_data.to_dict()
            topics.append(topics_item)

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
                "position": position,
                "project": project,
                "topics": topics,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.current_focus_project import CurrentFocusProject
        from ..models.topic import Topic

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        title = d.pop("title")

        description = d.pop("description")

        def _parse_link(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        link = _parse_link(d.pop("link"))

        position = d.pop("position")

        def _parse_project(data: object) -> CurrentFocusProject | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                project_type_0 = CurrentFocusProject.from_dict(data)

                return project_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CurrentFocusProject | None, data)

        project = _parse_project(d.pop("project"))

        topics = []
        _topics = d.pop("topics")
        for topics_item_data in _topics:
            topics_item = Topic.from_dict(topics_item_data)

            topics.append(topics_item)

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        current_focus = cls(
            id=id,
            slug=slug,
            title=title,
            description=description,
            link=link,
            position=position,
            project=project,
            topics=topics,
            created_at=created_at,
            updated_at=updated_at,
        )

        return current_focus
