from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.chat_context_summary_language import ChatContextSummaryLanguage
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.chat_summary_reference import ChatSummaryReference


T = TypeVar("T", bound="ChatContextSummary")


@_attrs_define
class ChatContextSummary:
    """
    Attributes:
        language (ChatContextSummaryLanguage):
        goals (list[str] | Unset):
        open_questions (list[str] | Unset):
        covered (list[str] | Unset):
        visitor_claims (list[str] | Unset):
        references (list[ChatSummaryReference] | Unset):
    """

    language: ChatContextSummaryLanguage
    goals: list[str] | Unset = UNSET
    open_questions: list[str] | Unset = UNSET
    covered: list[str] | Unset = UNSET
    visitor_claims: list[str] | Unset = UNSET
    references: list[ChatSummaryReference] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        language = self.language.value

        goals: list[str] | Unset = UNSET
        if not isinstance(self.goals, Unset):
            goals = self.goals

        open_questions: list[str] | Unset = UNSET
        if not isinstance(self.open_questions, Unset):
            open_questions = self.open_questions

        covered: list[str] | Unset = UNSET
        if not isinstance(self.covered, Unset):
            covered = self.covered

        visitor_claims: list[str] | Unset = UNSET
        if not isinstance(self.visitor_claims, Unset):
            visitor_claims = self.visitor_claims

        references: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.references, Unset):
            references = []
            for references_item_data in self.references:
                references_item = references_item_data.to_dict()
                references.append(references_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "language": language,
            }
        )
        if goals is not UNSET:
            field_dict["goals"] = goals
        if open_questions is not UNSET:
            field_dict["openQuestions"] = open_questions
        if covered is not UNSET:
            field_dict["covered"] = covered
        if visitor_claims is not UNSET:
            field_dict["visitorClaims"] = visitor_claims
        if references is not UNSET:
            field_dict["references"] = references

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_summary_reference import ChatSummaryReference

        d = dict(src_dict)
        language = ChatContextSummaryLanguage(d.pop("language"))

        goals = cast(list[str], d.pop("goals", UNSET))

        open_questions = cast(list[str], d.pop("openQuestions", UNSET))

        covered = cast(list[str], d.pop("covered", UNSET))

        visitor_claims = cast(list[str], d.pop("visitorClaims", UNSET))

        _references = d.pop("references", UNSET)
        references: list[ChatSummaryReference] | Unset = UNSET
        if _references is not UNSET:
            references = []
            for references_item_data in _references:
                references_item = ChatSummaryReference.from_dict(references_item_data)

                references.append(references_item)

        chat_context_summary = cls(
            language=language,
            goals=goals,
            open_questions=open_questions,
            covered=covered,
            visitor_claims=visitor_claims,
            references=references,
        )

        return chat_context_summary
