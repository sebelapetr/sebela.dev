from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.technology import Technology


T = TypeVar("T", bound="CvTechnologiesPrimary")


@_attrs_define
class CvTechnologiesPrimary:
    """
    Attributes:
        core (list[Technology]): The primary core technologies. In catalog order: position, then slug.
        ai_engineering_focus (list[Technology]): The primary technologies of the AI engineering focus. In catalog order:
            position, then slug.
    """

    core: list[Technology]
    ai_engineering_focus: list[Technology]

    def to_dict(self) -> dict[str, Any]:
        core = []
        for core_item_data in self.core:
            core_item = core_item_data.to_dict()
            core.append(core_item)

        ai_engineering_focus = []
        for ai_engineering_focus_item_data in self.ai_engineering_focus:
            ai_engineering_focus_item = ai_engineering_focus_item_data.to_dict()
            ai_engineering_focus.append(ai_engineering_focus_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "core": core,
                "aiEngineeringFocus": ai_engineering_focus,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.technology import Technology

        d = dict(src_dict)
        core = []
        _core = d.pop("core")
        for core_item_data in _core:
            core_item = Technology.from_dict(core_item_data)

            core.append(core_item)

        ai_engineering_focus = []
        _ai_engineering_focus = d.pop("aiEngineeringFocus")
        for ai_engineering_focus_item_data in _ai_engineering_focus:
            ai_engineering_focus_item = Technology.from_dict(
                ai_engineering_focus_item_data
            )

            ai_engineering_focus.append(ai_engineering_focus_item)

        cv_technologies_primary = cls(
            core=core,
            ai_engineering_focus=ai_engineering_focus,
        )

        return cv_technologies_primary
