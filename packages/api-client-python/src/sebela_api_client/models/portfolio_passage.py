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
    from ..models.portfolio_passage_provenance import PortfolioPassageProvenance


T = TypeVar("T", bound="PortfolioPassage")


@_attrs_define
class PortfolioPassage:
    """A passage of a public portfolio record.

    Attributes:
        source_kind (Literal['portfolio']):
        source_id (str): `portfolio:<content kind>:<slug or date>` of the public record.
        title (str):
        version (str): SHA-256 of the indexed source text; changes when the source changes.
        text (str):
        score (float): Relevance to the query, higher is better: the reranker's score in the deployed search.
        path (str): The canonical site path of the record, never an absolute URL.
        provenance (PortfolioPassageProvenance):
    """

    source_kind: Literal["portfolio"]
    source_id: str
    title: str
    version: str
    text: str
    score: float
    path: str
    provenance: PortfolioPassageProvenance

    def to_dict(self) -> dict[str, Any]:
        source_kind = self.source_kind

        source_id = self.source_id

        title = self.title

        version = self.version

        text = self.text

        score = self.score

        path = self.path

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
                "path": path,
                "provenance": provenance,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.portfolio_passage_provenance import PortfolioPassageProvenance

        d = dict(src_dict)
        source_kind = cast(Literal["portfolio"], d.pop("sourceKind"))
        if source_kind != "portfolio":
            raise ValueError(
                f"sourceKind must match const 'portfolio', got '{source_kind}'"
            )

        source_id = d.pop("sourceId")

        title = d.pop("title")

        version = d.pop("version")

        text = d.pop("text")

        score = d.pop("score")

        path = d.pop("path")

        provenance = PortfolioPassageProvenance.from_dict(d.pop("provenance"))

        portfolio_passage = cls(
            source_kind=source_kind,
            source_id=source_id,
            title=title,
            version=version,
            text=text,
            score=score,
            path=path,
            provenance=provenance,
        )

        return portfolio_passage
