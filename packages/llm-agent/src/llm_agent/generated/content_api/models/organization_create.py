from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="OrganizationCreate")


@_attrs_define
class OrganizationCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        website (None | str | Unset): The organization's own website.
        description (None | str | Unset): Markdown.
        logo_id (None | Unset | UUID): The identifier of the organization's logo, an uploaded image.
    """

    slug: str
    name: str
    website: None | str | Unset = UNSET
    description: None | str | Unset = UNSET
    logo_id: None | Unset | UUID = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        website: None | str | Unset
        if isinstance(self.website, Unset):
            website = UNSET
        else:
            website = self.website

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        logo_id: None | str | Unset
        if isinstance(self.logo_id, Unset):
            logo_id = UNSET
        elif isinstance(self.logo_id, UUID):
            logo_id = str(self.logo_id)
        else:
            logo_id = self.logo_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
            }
        )
        if website is not UNSET:
            field_dict["website"] = website
        if description is not UNSET:
            field_dict["description"] = description
        if logo_id is not UNSET:
            field_dict["logoId"] = logo_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        def _parse_website(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        website = _parse_website(d.pop("website", UNSET))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_logo_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                logo_id_type_0 = UUID(data)

                return logo_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        logo_id = _parse_logo_id(d.pop("logoId", UNSET))

        organization_create = cls(
            slug=slug,
            name=name,
            website=website,
            description=description,
            logo_id=logo_id,
        )

        return organization_create
