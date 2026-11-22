from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.service_evidence_exploration_status import (
    ServiceEvidenceExplorationStatus,
)

T = TypeVar("T", bound="ServiceEvidenceExploration")


@_attrs_define
class ServiceEvidenceExploration:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        summary (str): Markdown.
        status (ServiceEvidenceExplorationStatus): How far the exploration got, exactly as stored; never shown stronger.
    """

    slug: str
    name: str
    summary: str
    status: ServiceEvidenceExplorationStatus

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        summary = self.summary

        status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "summary": summary,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        status = ServiceEvidenceExplorationStatus(d.pop("status"))

        service_evidence_exploration = cls(
            slug=slug,
            name=name,
            summary=summary,
            status=status,
        )

        return service_evidence_exploration
