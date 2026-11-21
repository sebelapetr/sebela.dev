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
    from ..models.portfolio_passage import PortfolioPassage
    from ..models.supplemental_passage import SupplementalPassage


T = TypeVar("T", bound="SearchResultType1")


@_attrs_define
class SearchResultType1:
    """
    Attributes:
        status (Literal['no_evidence']):
        passages (list[PortfolioPassage | SupplementalPassage]):
    """

    status: Literal["no_evidence"]
    passages: list[PortfolioPassage | SupplementalPassage]

    def to_dict(self) -> dict[str, Any]:
        from ..models.portfolio_passage import PortfolioPassage

        status = self.status

        passages = []
        for passages_item_data in self.passages:
            passages_item: dict[str, Any]
            if isinstance(passages_item_data, PortfolioPassage):
                passages_item = passages_item_data.to_dict()
            else:
                passages_item = passages_item_data.to_dict()

            passages.append(passages_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "passages": passages,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.portfolio_passage import PortfolioPassage
        from ..models.supplemental_passage import SupplementalPassage

        d = dict(src_dict)
        status = cast(Literal["no_evidence"], d.pop("status"))
        if status != "no_evidence":
            raise ValueError(f"status must match const 'no_evidence', got '{status}'")

        passages = []
        _passages = d.pop("passages")
        for passages_item_data in _passages:

            def _parse_passages_item(
                data: object,
            ) -> PortfolioPassage | SupplementalPassage:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_passage_type_0 = PortfolioPassage.from_dict(data)

                    return componentsschemas_passage_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_passage_type_1 = SupplementalPassage.from_dict(data)

                return componentsschemas_passage_type_1

            passages_item = _parse_passages_item(passages_item_data)

            passages.append(passages_item)

        search_result_type_1 = cls(
            status=status,
            passages=passages,
        )

        return search_result_type_1
