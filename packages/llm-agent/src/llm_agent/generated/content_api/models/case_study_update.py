from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CaseStudyUpdate")


@_attrs_define
class CaseStudyUpdate:
    """
    Attributes:
        role (str | Unset): The person's own role in the project, as plain text, for example `Lead engineer`.
        body (str | Unset): The long-form account of the project. Markdown, stored as written; never HTML.
    """

    role: str | Unset = UNSET
    body: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        role = self.role

        body = self.body

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if role is not UNSET:
            field_dict["role"] = role
        if body is not UNSET:
            field_dict["body"] = body

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        role = d.pop("role", UNSET)

        body = d.pop("body", UNSET)

        case_study_update = cls(
            role=role,
            body=body,
        )

        return case_study_update
