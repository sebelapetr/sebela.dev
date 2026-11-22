from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.retrieval_content_kind import RetrievalContentKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="SearchRequest")


@_attrs_define
class SearchRequest:
    """A search of the indexed knowledge.

    Attributes:
        query (str): The question or keywords, at most 500 characters after trimming.
        kinds (list[RetrievalContentKind] | Unset): Only passages of these content kinds; every kind when absent.
        limit (int | Unset): The most passages to return; the configured number when absent.
    """

    query: str
    kinds: list[RetrievalContentKind] | Unset = UNSET
    limit: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        query = self.query

        kinds: list[str] | Unset = UNSET
        if not isinstance(self.kinds, Unset):
            kinds = []
            for kinds_item_data in self.kinds:
                kinds_item = kinds_item_data.value
                kinds.append(kinds_item)

        limit = self.limit

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "query": query,
            }
        )
        if kinds is not UNSET:
            field_dict["kinds"] = kinds
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        query = d.pop("query")

        _kinds = d.pop("kinds", UNSET)
        kinds: list[RetrievalContentKind] | Unset = UNSET
        if _kinds is not UNSET:
            kinds = []
            for kinds_item_data in _kinds:
                kinds_item = RetrievalContentKind(kinds_item_data)

                kinds.append(kinds_item)

        limit = d.pop("limit", UNSET)

        search_request = cls(
            query=query,
            kinds=kinds,
            limit=limit,
        )

        return search_request
