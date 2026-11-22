from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CaseStudyCreate")


@_attrs_define
class CaseStudyCreate:
    """
    Attributes:
        role (str): The person's own role in the project, as plain text, for example `Lead engineer`.
        body (str): The long-form account of the project. Markdown, stored as written; never HTML.
    """

    role: str
    body: str

    def to_dict(self) -> dict[str, Any]:
        role = self.role

        body = self.body

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "role": role,
                "body": body,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        role = d.pop("role")

        body = d.pop("body")

        case_study_create = cls(
            role=role,
            body=body,
        )

        return case_study_create
