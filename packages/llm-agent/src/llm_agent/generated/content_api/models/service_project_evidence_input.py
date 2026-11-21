from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

T = TypeVar("T", bound="ServiceProjectEvidenceInput")


@_attrs_define
class ServiceProjectEvidenceInput:
    """
    Attributes:
        kind (Literal['project']):
        project (str): The slug of an existing project.
    """

    kind: Literal["project"]
    project: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        project = self.project

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "project": project,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        kind = cast(Literal["project"], d.pop("kind"))
        if kind != "project":
            raise ValueError(f"kind must match const 'project', got '{kind}'")

        project = d.pop("project")

        service_project_evidence_input = cls(
            kind=kind,
            project=project,
        )

        return service_project_evidence_input
