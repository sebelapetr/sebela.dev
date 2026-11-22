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
    from ..models.service_evidence_exploration import ServiceEvidenceExploration


T = TypeVar("T", bound="ServiceExplorationEvidence")


@_attrs_define
class ServiceExplorationEvidence:
    """
    Attributes:
        kind (Literal['exploration']):
        exploration (ServiceEvidenceExploration):
    """

    kind: Literal["exploration"]
    exploration: ServiceEvidenceExploration

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        exploration = self.exploration.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "exploration": exploration,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.service_evidence_exploration import ServiceEvidenceExploration

        d = dict(src_dict)
        kind = cast(Literal["exploration"], d.pop("kind"))
        if kind != "exploration":
            raise ValueError(f"kind must match const 'exploration', got '{kind}'")

        exploration = ServiceEvidenceExploration.from_dict(d.pop("exploration"))

        service_exploration_evidence = cls(
            kind=kind,
            exploration=exploration,
        )

        return service_exploration_evidence
