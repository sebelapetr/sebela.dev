from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.service_exploration_evidence import ServiceExplorationEvidence
    from ..models.service_link_evidence import ServiceLinkEvidence
    from ..models.service_project_evidence import ServiceProjectEvidence


T = TypeVar("T", bound="Service")


@_attrs_define
class Service:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        summary (str): Markdown.
        audience (str): Who the service is for. Markdown.
        deliverable (str): What the client gets. Markdown.
        position (int): Ascending order in the list; ties are ordered by slug.
        evidence (list[ServiceExplorationEvidence | ServiceLinkEvidence | ServiceProjectEvidence]): The evidence for the
            service, in its intended order.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    name: str
    summary: str
    audience: str
    deliverable: str
    position: int
    evidence: list[
        ServiceExplorationEvidence | ServiceLinkEvidence | ServiceProjectEvidence
    ]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.service_exploration_evidence import ServiceExplorationEvidence
        from ..models.service_project_evidence import ServiceProjectEvidence

        id = str(self.id)

        slug = self.slug

        name = self.name

        summary = self.summary

        audience = self.audience

        deliverable = self.deliverable

        position = self.position

        evidence = []
        for evidence_item_data in self.evidence:
            evidence_item: dict[str, Any]
            if isinstance(evidence_item_data, ServiceProjectEvidence) or isinstance(
                evidence_item_data, ServiceExplorationEvidence
            ):
                evidence_item = evidence_item_data.to_dict()
            else:
                evidence_item = evidence_item_data.to_dict()

            evidence.append(evidence_item)

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "summary": summary,
                "audience": audience,
                "deliverable": deliverable,
                "position": position,
                "evidence": evidence,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.service_exploration_evidence import ServiceExplorationEvidence
        from ..models.service_link_evidence import ServiceLinkEvidence
        from ..models.service_project_evidence import ServiceProjectEvidence

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        audience = d.pop("audience")

        deliverable = d.pop("deliverable")

        position = d.pop("position")

        evidence = []
        _evidence = d.pop("evidence")
        for evidence_item_data in _evidence:

            def _parse_evidence_item(
                data: object,
            ) -> (
                ServiceExplorationEvidence
                | ServiceLinkEvidence
                | ServiceProjectEvidence
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_service_evidence_type_0 = (
                        ServiceProjectEvidence.from_dict(data)
                    )

                    return componentsschemas_service_evidence_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_service_evidence_type_1 = (
                        ServiceExplorationEvidence.from_dict(data)
                    )

                    return componentsschemas_service_evidence_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_service_evidence_type_2 = (
                    ServiceLinkEvidence.from_dict(data)
                )

                return componentsschemas_service_evidence_type_2

            evidence_item = _parse_evidence_item(evidence_item_data)

            evidence.append(evidence_item)

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        service = cls(
            id=id,
            slug=slug,
            name=name,
            summary=summary,
            audience=audience,
            deliverable=deliverable,
            position=position,
            evidence=evidence,
            created_at=created_at,
            updated_at=updated_at,
        )

        return service
