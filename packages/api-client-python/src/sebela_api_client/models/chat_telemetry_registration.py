from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatTelemetryRegistration")


@_attrs_define
class ChatTelemetryRegistration:
    """
    Attributes:
        grant (str):
        trace_id (str):
    """

    grant: str
    trace_id: str

    def to_dict(self) -> dict[str, Any]:
        grant = self.grant

        trace_id = self.trace_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "grant": grant,
                "traceId": trace_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        grant = d.pop("grant")

        trace_id = d.pop("traceId")

        chat_telemetry_registration = cls(
            grant=grant,
            trace_id=trace_id,
        )

        return chat_telemetry_registration
