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
    from ..models.supplemental_passage_provenance import SupplementalPassageProvenance


T = TypeVar("T", bound="SupplementalPassage")


@_attrs_define
class SupplementalPassage:
    """A passage of an approved supplemental document: a label, never a link.

    Attributes:
        source_kind (Literal['supplemental']):
        source_id (str): `document:<slug>`, an opaque identifier; never an address.
        title (str):
        version (str): SHA-256 of the indexed source text; changes when the source changes.
        text (str):
        score (float): Relevance to the query, higher is better: the reranker's score in the deployed search.
        provenance (SupplementalPassageProvenance):
    """

    source_kind: Literal["supplemental"]
    source_id: str
    title: str
    version: str
    text: str
    score: float
    provenance: SupplementalPassageProvenance

    def to_dict(self) -> dict[str, Any]:
        source_kind = self.source_kind

        source_id = self.source_id

        title = self.title

        version = self.version

        text = self.text

        score = self.score

        provenance = self.provenance.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sourceKind": source_kind,
                "sourceId": source_id,
                "title": title,
                "version": version,
                "text": text,
                "score": score,
                "provenance": provenance,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.supplemental_passage_provenance import (
            SupplementalPassageProvenance,
        )

        d = dict(src_dict)
        source_kind = cast(Literal["supplemental"], d.pop("sourceKind"))
        if source_kind != "supplemental":
            raise ValueError(
                f"sourceKind must match const 'supplemental', got '{source_kind}'"
            )

        source_id = d.pop("sourceId")

        title = d.pop("title")

        version = d.pop("version")

        text = d.pop("text")

        score = d.pop("score")

        provenance = SupplementalPassageProvenance.from_dict(d.pop("provenance"))

        supplemental_passage = cls(
            source_kind=source_kind,
            source_id=source_id,
            title=title,
            version=version,
            text=text,
            score=score,
            provenance=provenance,
        )

        return supplemental_passage
