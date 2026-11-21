from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="TestimonialUpdate")


@_attrs_define
class TestimonialUpdate:
    """
    Attributes:
        experience (str | Unset): The slug of the existing experience the testimonial belongs to. On an update it moves
            the testimonial to that experience.
        quote (str | Unset): What the author said, plain text without quotation marks.
        author_name (str | Unset): The name of the client or colleague who said it.
        author_role (str | Unset): The author's role, for example `Head of Operations`; the organization comes from the
            experience.
        position (int | Unset): Ascending order within the experience; ties are ordered by slug.
        author_photo_id (None | Unset | UUID): The identifier of the author's photo, an uploaded image; `null` without
            one.
    """

    experience: str | Unset = UNSET
    quote: str | Unset = UNSET
    author_name: str | Unset = UNSET
    author_role: str | Unset = UNSET
    position: int | Unset = UNSET
    author_photo_id: None | Unset | UUID = UNSET

    def to_dict(self) -> dict[str, Any]:
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

        field_dict.update({})
        if experience is not UNSET:
            field_dict["experience"] = experience
        if quote is not UNSET:
            field_dict["quote"] = quote
        if author_name is not UNSET:
            field_dict["authorName"] = author_name
        if author_role is not UNSET:
            field_dict["authorRole"] = author_role
        if position is not UNSET:
            field_dict["position"] = position
        if author_photo_id is not UNSET:
            field_dict["authorPhotoId"] = author_photo_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        experience = d.pop("experience", UNSET)

        quote = d.pop("quote", UNSET)

        author_name = d.pop("authorName", UNSET)

        author_role = d.pop("authorRole", UNSET)

        position = d.pop("position", UNSET)

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

        testimonial_update = cls(
            experience=experience,
            quote=quote,
            author_name=author_name,
            author_role=author_role,
            position=position,
            author_photo_id=author_photo_id,
        )

        return testimonial_update
