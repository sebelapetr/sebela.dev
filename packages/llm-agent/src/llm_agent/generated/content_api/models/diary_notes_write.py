from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DiaryNotesWrite")


@_attrs_define
class DiaryNotesWrite:
    """
    Attributes:
        notes (str): Markdown.
    """

    notes: str

    def to_dict(self) -> dict[str, Any]:
        notes = self.notes

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "notes": notes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        notes = d.pop("notes")

        diary_notes_write = cls(
            notes=notes,
        )

        return diary_notes_write
