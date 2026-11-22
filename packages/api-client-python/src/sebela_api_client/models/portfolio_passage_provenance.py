from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.portfolio_passage_provenance_content_kind import (
    PortfolioPassageProvenanceContentKind,
)

T = TypeVar("T", bound="PortfolioPassageProvenance")


@_attrs_define
class PortfolioPassageProvenance:
    """
    Attributes:
        content_kind (PortfolioPassageProvenanceContentKind):
        section_path (list[str]): The headings from the source title down to the passage's section.
        indexed_at (datetime.datetime):
    """

    content_kind: PortfolioPassageProvenanceContentKind
    section_path: list[str]
    indexed_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        content_kind = self.content_kind.value

        section_path = self.section_path

        indexed_at = self.indexed_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "contentKind": content_kind,
                "sectionPath": section_path,
                "indexedAt": indexed_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        content_kind = PortfolioPassageProvenanceContentKind(d.pop("contentKind"))

        section_path = cast(list[str], d.pop("sectionPath"))

        indexed_at = datetime.datetime.fromisoformat(d.pop("indexedAt"))

        portfolio_passage_provenance = cls(
            content_kind=content_kind,
            section_path=section_path,
            indexed_at=indexed_at,
        )

        return portfolio_passage_provenance
