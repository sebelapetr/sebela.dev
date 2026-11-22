from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.technology_create_group_type_0 import TechnologyCreateGroupType0
from ..models.technology_create_tier import TechnologyCreateTier
from ..types import UNSET, Unset

T = TypeVar("T", bound="TechnologyCreate")


@_attrs_define
class TechnologyCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        tier (TechnologyCreateTier): `primary` technologies are shown prominently, `secondary` ones as plain text.
        position (int): Ascending order in the list; ties are ordered by slug.
        group (None | TechnologyCreateGroupType0 | Unset): The group of a primary technology: `core` (with logos) or
            `ai_engineering_focus` (plain text). A secondary technology has none.
        logo_key (None | str | Unset):
    """

    slug: str
    name: str
    tier: TechnologyCreateTier
    position: int
    group: None | TechnologyCreateGroupType0 | Unset = UNSET
    logo_key: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        tier = self.tier.value

        position = self.position

        group: None | str | Unset
        if isinstance(self.group, Unset):
            group = UNSET
        elif isinstance(self.group, TechnologyCreateGroupType0):
            group = self.group.value
        else:
            group = self.group

        logo_key: None | str | Unset
        if isinstance(self.logo_key, Unset):
            logo_key = UNSET
        else:
            logo_key = self.logo_key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "tier": tier,
                "position": position,
            }
        )
        if group is not UNSET:
            field_dict["group"] = group
        if logo_key is not UNSET:
            field_dict["logoKey"] = logo_key

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        tier = TechnologyCreateTier(d.pop("tier"))

        position = d.pop("position")

        def _parse_group(data: object) -> None | TechnologyCreateGroupType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                group_type_0 = TechnologyCreateGroupType0(data)

                return group_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TechnologyCreateGroupType0 | Unset, data)

        group = _parse_group(d.pop("group", UNSET))

        def _parse_logo_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        logo_key = _parse_logo_key(d.pop("logoKey", UNSET))

        technology_create = cls(
            slug=slug,
            name=name,
            tier=tier,
            position=position,
            group=group,
            logo_key=logo_key,
        )

        return technology_create
