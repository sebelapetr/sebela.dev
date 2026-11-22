from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.audit_change_operation_method import AuditChangeOperationMethod

T = TypeVar("T", bound="AuditChangeOperation")


@_attrs_define
class AuditChangeOperation:
    """
    Attributes:
        operation_id (str):
        method (AuditChangeOperationMethod):
        route (str):
    """

    operation_id: str
    method: AuditChangeOperationMethod
    route: str

    def to_dict(self) -> dict[str, Any]:
        operation_id = self.operation_id

        method = self.method.value

        route = self.route

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "operationId": operation_id,
                "method": method,
                "route": route,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        operation_id = d.pop("operationId")

        method = AuditChangeOperationMethod(d.pop("method"))

        route = d.pop("route")

        audit_change_operation = cls(
            operation_id=operation_id,
            method=method,
            route=route,
        )

        return audit_change_operation
