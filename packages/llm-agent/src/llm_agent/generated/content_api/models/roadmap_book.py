from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.roadmap_book_status import RoadmapBookStatus

if TYPE_CHECKING:
    from ..models.media import Media
    from ..models.roadmap_book_resource import RoadmapBookResource


T = TypeVar("T", bound="RoadmapBook")


@_attrs_define
class RoadmapBook:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `paldock`.
        title (str):
        author (None | str): `null` when unknown.
        description (None | str): A short Markdown introduction; `null` when there is none.
        pages (int | None): `null` when unknown.
        year (int | None): The publication year; `null` when unknown.
        isbn (None | str): An ISBN-10 or ISBN-13 as printed; `null` when unknown.
        priority (int): Shelf order: books are listed by ascending priority, then by slug.
        started_on (datetime.date | None): The day reading started, `YYYY-MM-DD`; `null` when it has not.
        ended_on (datetime.date | None): The day reading ended, `YYYY-MM-DD`, not before `startedOn`; `null` when it has
            not.
        summary (None | str): The reading summary in Markdown; `null` when there is none.
        cover_id (None | UUID): The identifier of an uploaded image used as the cover; `null` when there is none. It
            must exist and be an image when written.
        cover (Media | None): The cover image; `null` when none.
        status (RoadmapBookStatus): Derived on read: `completed` when `endedOn` is set, otherwise `reading` when
            `startedOn` is set, otherwise `to-read`.
        resource (None | RoadmapBookResource): The resource of type `book` that links this book; `null` when none does.
        reading_seconds (int): The elapsed seconds of every time entry logged on the linking resource; `0` without one.
            Derived on read; the book has no time of its own.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    title: str
    author: None | str
    description: None | str
    pages: int | None
    year: int | None
    isbn: None | str
    priority: int
    started_on: datetime.date | None
    ended_on: datetime.date | None
    summary: None | str
    cover_id: None | UUID
    cover: Media | None
    status: RoadmapBookStatus
    resource: None | RoadmapBookResource
    reading_seconds: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.media import Media
        from ..models.roadmap_book_resource import RoadmapBookResource

        id = str(self.id)

        slug = self.slug

        title = self.title

        author: None | str
        author = self.author

        description: None | str
        description = self.description

        pages: int | None
        pages = self.pages

        year: int | None
        year = self.year

        isbn: None | str
        isbn = self.isbn

        priority = self.priority

        started_on: None | str
        if isinstance(self.started_on, datetime.date):
            started_on = self.started_on.isoformat()
        else:
            started_on = self.started_on

        ended_on: None | str
        if isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        summary: None | str
        summary = self.summary

        cover_id: None | str
        if isinstance(self.cover_id, UUID):
            cover_id = str(self.cover_id)
        else:
            cover_id = self.cover_id

        cover: dict[str, Any] | None
        if isinstance(self.cover, Media):
            cover = self.cover.to_dict()
        else:
            cover = self.cover

        status = self.status.value

        resource: dict[str, Any] | None
        if isinstance(self.resource, RoadmapBookResource):
            resource = self.resource.to_dict()
        else:
            resource = self.resource

        reading_seconds = self.reading_seconds

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "title": title,
                "author": author,
                "description": description,
                "pages": pages,
                "year": year,
                "isbn": isbn,
                "priority": priority,
                "startedOn": started_on,
                "endedOn": ended_on,
                "summary": summary,
                "coverId": cover_id,
                "cover": cover,
                "status": status,
                "resource": resource,
                "readingSeconds": reading_seconds,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.media import Media
        from ..models.roadmap_book_resource import RoadmapBookResource

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        title = d.pop("title")

        def _parse_author(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author = _parse_author(d.pop("author"))

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        def _parse_pages(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        pages = _parse_pages(d.pop("pages"))

        def _parse_year(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        year = _parse_year(d.pop("year"))

        def _parse_isbn(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        isbn = _parse_isbn(d.pop("isbn"))

        priority = d.pop("priority")

        def _parse_started_on(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_on_type_0 = datetime.date.fromisoformat(data)

                return started_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        started_on = _parse_started_on(d.pop("startedOn"))

        def _parse_ended_on(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ended_on_type_0 = datetime.date.fromisoformat(data)

                return ended_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        ended_on = _parse_ended_on(d.pop("endedOn"))

        def _parse_summary(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        summary = _parse_summary(d.pop("summary"))

        def _parse_cover_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                cover_id_type_0 = UUID(data)

                return cover_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        cover_id = _parse_cover_id(d.pop("coverId"))

        def _parse_cover(data: object) -> Media | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                cover_type_0 = Media.from_dict(data)

                return cover_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(Media | None, data)

        cover = _parse_cover(d.pop("cover"))

        status = RoadmapBookStatus(d.pop("status"))

        def _parse_resource(data: object) -> None | RoadmapBookResource:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                resource_type_0 = RoadmapBookResource.from_dict(data)

                return resource_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | RoadmapBookResource, data)

        resource = _parse_resource(d.pop("resource"))

        reading_seconds = d.pop("readingSeconds")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_book = cls(
            id=id,
            slug=slug,
            title=title,
            author=author,
            description=description,
            pages=pages,
            year=year,
            isbn=isbn,
            priority=priority,
            started_on=started_on,
            ended_on=ended_on,
            summary=summary,
            cover_id=cover_id,
            cover=cover,
            status=status,
            resource=resource,
            reading_seconds=reading_seconds,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_book
