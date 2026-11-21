from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.technology_update_group_type_0 import TechnologyUpdateGroupType0
from ..models.technology_update_tier import TechnologyUpdateTier
from ..types import UNSET, Unset

T = TypeVar("T", bound="TechnologyUpdate")


@_attrs_define
class TechnologyUpdate:
    """
    Attributes:
        name (str | Unset):
        tier (TechnologyUpdateTier | Unset): `primary` technologies are shown prominently, `secondary` ones as plain
            text.
        group (None | TechnologyUpdateGroupType0 | Unset): The group of a primary technology: `core` (with logos) or
            `ai_engineering_focus` (plain text). A secondary technology has none.
        logo_key (None | str | Unset):
        position (int | Unset): Ascending order in the list; ties are ordered by slug.
    """

    name: str | Unset = UNSET
    tier: TechnologyUpdateTier | Unset = UNSET
    group: None | TechnologyUpdateGroupType0 | Unset = UNSET
    logo_key: None | str | Unset = UNSET
    position: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        tier: str | Unset = UNSET
        if not isinstance(self.tier, Unset):
            tier = self.tier.value

        group: None | str | Unset
        if isinstance(self.group, Unset):
            group = UNSET
        elif isinstance(self.group, TechnologyUpdateGroupType0):
            group = self.group.value
        else:
            group = self.group

        logo_key: None | str | Unset
        if isinstance(self.logo_key, Unset):
            logo_key = UNSET
        else:
            logo_key = self.logo_key

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if tier is not UNSET:
            field_dict["tier"] = tier
        if group is not UNSET:
            field_dict["group"] = group
        if logo_key is not UNSET:
            field_dict["logoKey"] = logo_key
        if position is not UNSET:
            field_dict["position"] = position

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _tier = d.pop("tier", UNSET)
        tier: TechnologyUpdateTier | Unset
        if isinstance(_tier, Unset):
            tier = UNSET
        else:
            tier = TechnologyUpdateTier(_tier)

        def _parse_group(data: object) -> None | TechnologyUpdateGroupType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                group_type_0 = TechnologyUpdateGroupType0(data)

                return group_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TechnologyUpdateGroupType0 | Unset, data)

        group = _parse_group(d.pop("group", UNSET))

        def _parse_logo_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        logo_key = _parse_logo_key(d.pop("logoKey", UNSET))

        position = d.pop("position", UNSET)

        technology_update = cls(
            name=name,
            tier=tier,
            group=group,
            logo_key=logo_key,
            position=position,
        )

        return technology_update
