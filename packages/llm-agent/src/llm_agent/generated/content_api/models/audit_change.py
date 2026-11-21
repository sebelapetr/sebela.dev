from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.audit_change_action import AuditChangeAction
from ..models.audit_change_entity import AuditChangeEntity

if TYPE_CHECKING:
    from ..models.audit_change_actor import AuditChangeActor
    from ..models.audit_change_after_type_0 import AuditChangeAfterType0
    from ..models.audit_change_before_type_0 import AuditChangeBeforeType0
    from ..models.audit_change_operation import AuditChangeOperation


T = TypeVar("T", bound="AuditChange")


@_attrs_define
class AuditChange:
    """
    Attributes:
        id (int):
        occurred_at (datetime.datetime):
        actor (AuditChangeActor):
        operation (AuditChangeOperation):
        provenance (None | str):
        entity (AuditChangeEntity):
        record (None | str):
        action (AuditChangeAction):
        before (AuditChangeBeforeType0 | None):
        after (AuditChangeAfterType0 | None):
    """

    id: int
    occurred_at: datetime.datetime
    actor: AuditChangeActor
    operation: AuditChangeOperation
    provenance: None | str
    entity: AuditChangeEntity
    record: None | str
    action: AuditChangeAction
    before: AuditChangeBeforeType0 | None
    after: AuditChangeAfterType0 | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.audit_change_after_type_0 import AuditChangeAfterType0
        from ..models.audit_change_before_type_0 import AuditChangeBeforeType0

        id = self.id

        occurred_at = self.occurred_at.isoformat()

        actor = self.actor.to_dict()

        operation = self.operation.to_dict()

        provenance: None | str
        provenance = self.provenance

        entity = self.entity.value

        record: None | str
        record = self.record

        action = self.action.value

        before: dict[str, Any] | None
        if isinstance(self.before, AuditChangeBeforeType0):
            before = self.before.to_dict()
        else:
            before = self.before

        after: dict[str, Any] | None
        if isinstance(self.after, AuditChangeAfterType0):
            after = self.after.to_dict()
        else:
            after = self.after

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "occurredAt": occurred_at,
                "actor": actor,
                "operation": operation,
                "provenance": provenance,
                "entity": entity,
                "record": record,
                "action": action,
                "before": before,
                "after": after,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.audit_change_actor import AuditChangeActor
        from ..models.audit_change_after_type_0 import AuditChangeAfterType0
        from ..models.audit_change_before_type_0 import AuditChangeBeforeType0
        from ..models.audit_change_operation import AuditChangeOperation

        d = dict(src_dict)
        id = d.pop("id")

        occurred_at = datetime.datetime.fromisoformat(d.pop("occurredAt"))

        actor = AuditChangeActor.from_dict(d.pop("actor"))

        operation = AuditChangeOperation.from_dict(d.pop("operation"))

        def _parse_provenance(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provenance = _parse_provenance(d.pop("provenance"))

        entity = AuditChangeEntity(d.pop("entity"))

        def _parse_record(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        record = _parse_record(d.pop("record"))

        action = AuditChangeAction(d.pop("action"))

        def _parse_before(data: object) -> AuditChangeBeforeType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                before_type_0 = AuditChangeBeforeType0.from_dict(data)

                return before_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(AuditChangeBeforeType0 | None, data)

        before = _parse_before(d.pop("before"))

        def _parse_after(data: object) -> AuditChangeAfterType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                after_type_0 = AuditChangeAfterType0.from_dict(data)

                return after_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(AuditChangeAfterType0 | None, data)

        after = _parse_after(d.pop("after"))

        audit_change = cls(
            id=id,
            occurred_at=occurred_at,
            actor=actor,
            operation=operation,
            provenance=provenance,
            entity=entity,
            record=record,
            action=action,
            before=before,
            after=after,
        )

        return audit_change
