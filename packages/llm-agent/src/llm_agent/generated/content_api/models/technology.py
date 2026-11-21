from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.technology_group_type_0 import TechnologyGroupType0
from ..models.technology_tier import TechnologyTier

T = TypeVar("T", bound="Technology")


@_attrs_define
class Technology:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        tier (TechnologyTier): `primary` technologies are shown prominently, `secondary` ones as plain text.
        group (None | TechnologyGroupType0): The group of a primary technology: `core` (with logos) or
            `ai_engineering_focus` (plain text). A secondary technology has none.
        logo_key (None | str):
        position (int): Ascending order in the list; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    name: str
    tier: TechnologyTier
    group: None | TechnologyGroupType0
    logo_key: None | str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        name = self.name

        tier = self.tier.value

        group: None | str
        if isinstance(self.group, TechnologyGroupType0):
            group = self.group.value
        else:
            group = self.group

        logo_key: None | str
        logo_key = self.logo_key

        position = self.position

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "tier": tier,
                "group": group,
                "logoKey": logo_key,
                "position": position,
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

        name = d.pop("name")

        tier = TechnologyTier(d.pop("tier"))

        def _parse_group(data: object) -> None | TechnologyGroupType0:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                group_type_0 = TechnologyGroupType0(data)

                return group_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TechnologyGroupType0, data)

        group = _parse_group(d.pop("group"))

        def _parse_logo_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        logo_key = _parse_logo_key(d.pop("logoKey"))

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        technology = cls(
            id=id,
            slug=slug,
            name=name,
            tier=tier,
            group=group,
            logo_key=logo_key,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
        )

        return technology
