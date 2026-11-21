from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapBookUpdate")


@_attrs_define
class RoadmapBookUpdate:
    """
    Attributes:
        title (str | Unset):
        author (None | str | Unset): `null` when unknown.
        description (None | str | Unset): A short Markdown introduction; `null` when there is none.
        pages (int | None | Unset): `null` when unknown.
        year (int | None | Unset): The publication year; `null` when unknown.
        isbn (None | str | Unset): An ISBN-10 or ISBN-13 as printed; `null` when unknown.
        priority (int | Unset): Shelf order: books are listed by ascending priority, then by slug.
        started_on (datetime.date | None | Unset): The day reading started, `YYYY-MM-DD`; `null` when it has not.
        ended_on (datetime.date | None | Unset): The day reading ended, `YYYY-MM-DD`, not before `startedOn`; `null`
            when it has not.
        summary (None | str | Unset): The reading summary in Markdown; `null` when there is none.
        cover_id (None | Unset | UUID): The identifier of an uploaded image used as the cover; `null` when there is
            none. It must exist and be an image when written.
    """

    title: str | Unset = UNSET
    author: None | str | Unset = UNSET
    description: None | str | Unset = UNSET
    pages: int | None | Unset = UNSET
    year: int | None | Unset = UNSET
    isbn: None | str | Unset = UNSET
    priority: int | Unset = UNSET
    started_on: datetime.date | None | Unset = UNSET
    ended_on: datetime.date | None | Unset = UNSET
    summary: None | str | Unset = UNSET
    cover_id: None | Unset | UUID = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        author: None | str | Unset
        if isinstance(self.author, Unset):
            author = UNSET
        else:
            author = self.author

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        pages: int | None | Unset
        if isinstance(self.pages, Unset):
            pages = UNSET
        else:
            pages = self.pages

        year: int | None | Unset
        if isinstance(self.year, Unset):
            year = UNSET
        else:
            year = self.year

        isbn: None | str | Unset
        if isinstance(self.isbn, Unset):
            isbn = UNSET
        else:
            isbn = self.isbn

        priority = self.priority

        started_on: None | str | Unset
        if isinstance(self.started_on, Unset):
            started_on = UNSET
        elif isinstance(self.started_on, datetime.date):
            started_on = self.started_on.isoformat()
        else:
            started_on = self.started_on

        ended_on: None | str | Unset
        if isinstance(self.ended_on, Unset):
            ended_on = UNSET
        elif isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        summary: None | str | Unset
        if isinstance(self.summary, Unset):
            summary = UNSET
        else:
            summary = self.summary

        cover_id: None | str | Unset
        if isinstance(self.cover_id, Unset):
            cover_id = UNSET
        elif isinstance(self.cover_id, UUID):
            cover_id = str(self.cover_id)
        else:
            cover_id = self.cover_id

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if author is not UNSET:
            field_dict["author"] = author
        if description is not UNSET:
            field_dict["description"] = description
        if pages is not UNSET:
            field_dict["pages"] = pages
        if year is not UNSET:
            field_dict["year"] = year
        if isbn is not UNSET:
            field_dict["isbn"] = isbn
        if priority is not UNSET:
            field_dict["priority"] = priority
        if started_on is not UNSET:
            field_dict["startedOn"] = started_on
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if summary is not UNSET:
            field_dict["summary"] = summary
        if cover_id is not UNSET:
            field_dict["coverId"] = cover_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        def _parse_author(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        author = _parse_author(d.pop("author", UNSET))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_pages(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        pages = _parse_pages(d.pop("pages", UNSET))

        def _parse_year(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        year = _parse_year(d.pop("year", UNSET))

        def _parse_isbn(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        isbn = _parse_isbn(d.pop("isbn", UNSET))

        priority = d.pop("priority", UNSET)

        def _parse_started_on(data: object) -> datetime.date | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_on_type_0 = datetime.date.fromisoformat(data)

                return started_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None | Unset, data)

        started_on = _parse_started_on(d.pop("startedOn", UNSET))

        def _parse_ended_on(data: object) -> datetime.date | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ended_on_type_0 = datetime.date.fromisoformat(data)

                return ended_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None | Unset, data)

        ended_on = _parse_ended_on(d.pop("endedOn", UNSET))

        def _parse_summary(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        summary = _parse_summary(d.pop("summary", UNSET))

        def _parse_cover_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                cover_id_type_0 = UUID(data)

                return cover_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        cover_id = _parse_cover_id(d.pop("coverId", UNSET))

        roadmap_book_update = cls(
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
        )

        return roadmap_book_update
