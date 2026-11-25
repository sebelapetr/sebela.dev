from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatUsageModel")


@_attrs_define
class ChatUsageModel:
    """The server-configured main model and effort; read-only.

    Attributes:
        name (str):
        effort (str):
    """

    name: str
    effort: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        effort = self.effort

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "effort": effort,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name")

        effort = d.pop("effort")

        chat_usage_model = cls(
            name=name,
            effort=effort,
        )

        return chat_usage_model
