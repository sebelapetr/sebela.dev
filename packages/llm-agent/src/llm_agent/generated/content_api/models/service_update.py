from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.service_exploration_evidence_input import (
        ServiceExplorationEvidenceInput,
    )
    from ..models.service_link_evidence import ServiceLinkEvidence
    from ..models.service_project_evidence_input import ServiceProjectEvidenceInput


T = TypeVar("T", bound="ServiceUpdate")


@_attrs_define
class ServiceUpdate:
    """
    Attributes:
        name (str | Unset):
        summary (str | Unset): Markdown.
        audience (str | Unset): Who the service is for. Markdown.
        deliverable (str | Unset): What the client gets. Markdown.
        position (int | Unset): Ascending order in the list; ties are ordered by slug.
        evidence (list[ServiceExplorationEvidenceInput | ServiceLinkEvidence | ServiceProjectEvidenceInput] | Unset):
            The evidence in its intended order; each project and exploration at most once. On an update the list replaces
            all evidence; an omitted list leaves it unchanged.
    """

    name: str | Unset = UNSET
    summary: str | Unset = UNSET
    audience: str | Unset = UNSET
    deliverable: str | Unset = UNSET
    position: int | Unset = UNSET
    evidence: (
        list[
            ServiceExplorationEvidenceInput
            | ServiceLinkEvidence
            | ServiceProjectEvidenceInput
        ]
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.service_exploration_evidence_input import (
            ServiceExplorationEvidenceInput,
        )
        from ..models.service_project_evidence_input import ServiceProjectEvidenceInput

        name = self.name

        summary = self.summary

        audience = self.audience

        deliverable = self.deliverable

        position = self.position

        evidence: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evidence, Unset):
            evidence = []
            for evidence_item_data in self.evidence:
                evidence_item: dict[str, Any]
                if isinstance(
                    evidence_item_data, ServiceProjectEvidenceInput
                ) or isinstance(evidence_item_data, ServiceExplorationEvidenceInput):
                    evidence_item = evidence_item_data.to_dict()
                else:
                    evidence_item = evidence_item_data.to_dict()

                evidence.append(evidence_item)

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if summary is not UNSET:
            field_dict["summary"] = summary
        if audience is not UNSET:
            field_dict["audience"] = audience
        if deliverable is not UNSET:
            field_dict["deliverable"] = deliverable
        if position is not UNSET:
            field_dict["position"] = position
        if evidence is not UNSET:
            field_dict["evidence"] = evidence

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.service_exploration_evidence_input import (
            ServiceExplorationEvidenceInput,
        )
        from ..models.service_link_evidence import ServiceLinkEvidence
        from ..models.service_project_evidence_input import ServiceProjectEvidenceInput

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        summary = d.pop("summary", UNSET)

        audience = d.pop("audience", UNSET)

        deliverable = d.pop("deliverable", UNSET)

        position = d.pop("position", UNSET)

        _evidence = d.pop("evidence", UNSET)
        evidence: (
            list[
                ServiceExplorationEvidenceInput
                | ServiceLinkEvidence
                | ServiceProjectEvidenceInput
            ]
            | Unset
        ) = UNSET
        if _evidence is not UNSET:
            evidence = []
            for evidence_item_data in _evidence:

                def _parse_evidence_item(
                    data: object,
                ) -> (
                    ServiceExplorationEvidenceInput
                    | ServiceLinkEvidence
                    | ServiceProjectEvidenceInput
                ):
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_service_evidence_input_type_0 = (
                            ServiceProjectEvidenceInput.from_dict(data)
                        )

                        return componentsschemas_service_evidence_input_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_service_evidence_input_type_1 = (
                            ServiceExplorationEvidenceInput.from_dict(data)
                        )

                        return componentsschemas_service_evidence_input_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_service_evidence_input_type_2 = (
                        ServiceLinkEvidence.from_dict(data)
                    )

                    return componentsschemas_service_evidence_input_type_2

                evidence_item = _parse_evidence_item(evidence_item_data)

                evidence.append(evidence_item)

        service_update = cls(
            name=name,
            summary=summary,
            audience=audience,
            deliverable=deliverable,
            position=position,
            evidence=evidence,
        )

        return service_update
