from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="CaseStudy")


@_attrs_define
class CaseStudy:
    """
    Attributes:
        id (UUID):
        project (str): The slug of the project the case study explains.
        role (str): The person's own role in the project, as plain text, for example `Lead engineer`.
        body (str): The long-form account of the project. Markdown, stored as written; never HTML.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    project: str
    role: str
    body: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        project = self.project

        role = self.role

        body = self.body

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "project": project,
                "role": role,
                "body": body,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        project = d.pop("project")

        role = d.pop("role")

        body = d.pop("body")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        case_study = cls(
            id=id,
            project=project,
            role=role,
            body=body,
            created_at=created_at,
            updated_at=updated_at,
        )

        return case_study
