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

T = TypeVar("T", bound="ServiceExplorationEvidenceInput")


@_attrs_define
class ServiceExplorationEvidenceInput:
    """
    Attributes:
        kind (Literal['exploration']):
        exploration (str): The slug of an existing exploration.
    """

    kind: Literal["exploration"]
    exploration: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        exploration = self.exploration

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
        d = dict(src_dict)
        kind = cast(Literal["exploration"], d.pop("kind"))
        if kind != "exploration":
            raise ValueError(f"kind must match const 'exploration', got '{kind}'")

        exploration = d.pop("exploration")

        service_exploration_evidence_input = cls(
            kind=kind,
            exploration=exploration,
        )

        return service_exploration_evidence_input
