from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="Testimonial")


@_attrs_define
class Testimonial:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `paldock`.
        experience (str): The slug of the experience the testimonial belongs to; every testimonial has exactly one.
        quote (str): What the author said, plain text without quotation marks.
        author_name (str): The name of the client or colleague who said it.
        author_role (str): The author's role, for example `Head of Operations`; the organization comes from the
            experience.
        position (int): Ascending order within the experience; ties are ordered by slug.
        author_photo_id (None | UUID): The identifier of the author's photo, an uploaded image; `null` without one.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    experience: str
    quote: str
    author_name: str
    author_role: str
    position: int
    author_photo_id: None | UUID
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        experience = self.experience

        quote = self.quote

        author_name = self.author_name

        author_role = self.author_role

        position = self.position

        author_photo_id: None | str
        if isinstance(self.author_photo_id, UUID):
            author_photo_id = str(self.author_photo_id)
        else:
            author_photo_id = self.author_photo_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "experience": experience,
                "quote": quote,
                "authorName": author_name,
                "authorRole": author_role,
                "position": position,
                "authorPhotoId": author_photo_id,
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

        experience = d.pop("experience")

        quote = d.pop("quote")

        author_name = d.pop("authorName")

        author_role = d.pop("authorRole")

        position = d.pop("position")

        def _parse_author_photo_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                author_photo_id_type_0 = UUID(data)

                return author_photo_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        author_photo_id = _parse_author_photo_id(d.pop("authorPhotoId"))

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        testimonial = cls(
            id=id,
            slug=slug,
            experience=experience,
            quote=quote,
            author_name=author_name,
            author_role=author_role,
            position=position,
            author_photo_id=author_photo_id,
            created_at=created_at,
            updated_at=updated_at,
        )

        return testimonial
