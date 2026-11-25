from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="TestimonialCreate")


@_attrs_define
class TestimonialCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        experience (str): The slug of the existing experience the testimonial belongs to. On an update it moves the
            testimonial to that experience.
        quote (str): What the author said, plain text without quotation marks.
        author_name (str): The name of the client or colleague who said it.
        author_role (str): The author's role, for example `Head of Operations`; the organization comes from the
            experience.
        position (int): Ascending order within the experience; ties are ordered by slug.
        author_photo_id (None | Unset | UUID): The identifier of the author's photo, an uploaded image; `null` without
            one.
    """

    slug: str
    experience: str
    quote: str
    author_name: str
    author_role: str
    position: int
    author_photo_id: None | Unset | UUID = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        experience = self.experience

        quote = self.quote

        author_name = self.author_name

        author_role = self.author_role

        position = self.position

        author_photo_id: None | str | Unset
        if isinstance(self.author_photo_id, Unset):
            author_photo_id = UNSET
        elif isinstance(self.author_photo_id, UUID):
            author_photo_id = str(self.author_photo_id)
        else:
            author_photo_id = self.author_photo_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "experience": experience,
                "quote": quote,
                "authorName": author_name,
                "authorRole": author_role,
                "position": position,
            }
        )
        if author_photo_id is not UNSET:
            field_dict["authorPhotoId"] = author_photo_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        experience = d.pop("experience")

        quote = d.pop("quote")

        author_name = d.pop("authorName")

        author_role = d.pop("authorRole")

        position = d.pop("position")

        def _parse_author_photo_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                author_photo_id_type_0 = UUID(data)

                return author_photo_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        author_photo_id = _parse_author_photo_id(d.pop("authorPhotoId", UNSET))

        testimonial_create = cls(
            slug=slug,
            experience=experience,
            quote=quote,
            author_name=author_name,
            author_role=author_role,
            position=position,
            author_photo_id=author_photo_id,
        )

        return testimonial_create
