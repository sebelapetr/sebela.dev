from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.audit_change import AuditChange


T = TypeVar("T", bound="RecentChanges")


@_attrs_define
class RecentChanges:
    """
    Attributes:
        changes (list[AuditChange]):
    """

    changes: list[AuditChange]

    def to_dict(self) -> dict[str, Any]:
        changes = []
        for changes_item_data in self.changes:
            changes_item = changes_item_data.to_dict()
            changes.append(changes_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "changes": changes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.audit_change import AuditChange

        d = dict(src_dict)
        changes = []
        _changes = d.pop("changes")
        for changes_item_data in _changes:
            changes_item = AuditChange.from_dict(changes_item_data)

            changes.append(changes_item)

        recent_changes = cls(
            changes=changes,
        )

        return recent_changes
