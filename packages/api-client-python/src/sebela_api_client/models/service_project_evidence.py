from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.service_evidence_project import ServiceEvidenceProject


T = TypeVar("T", bound="ServiceProjectEvidence")


@_attrs_define
class ServiceProjectEvidence:
    """
    Attributes:
        kind (Literal['project']):
        project (ServiceEvidenceProject):
    """

    kind: Literal["project"]
    project: ServiceEvidenceProject

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        project = self.project.to_dict()

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
        from ..models.service_evidence_project import ServiceEvidenceProject

        d = dict(src_dict)
        kind = cast(Literal["project"], d.pop("kind"))
        if kind != "project":
            raise ValueError(f"kind must match const 'project', got '{kind}'")

        project = ServiceEvidenceProject.from_dict(d.pop("project"))

        service_project_evidence = cls(
            kind=kind,
            project=project,
        )

        return service_project_evidence
