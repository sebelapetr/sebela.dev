from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.chat_telemetry_registered_export import ChatTelemetryRegisteredExport

T = TypeVar("T", bound="ChatTelemetryRegistered")


@_attrs_define
class ChatTelemetryRegistered:
    """
    Attributes:
        trace_id (str):
        export (ChatTelemetryRegisteredExport):
        expires_at (datetime.datetime):
    """

    trace_id: str
    export: ChatTelemetryRegisteredExport
    expires_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        trace_id = self.trace_id

        export = self.export.value

        expires_at = self.expires_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "traceId": trace_id,
                "export": export,
                "expiresAt": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        trace_id = d.pop("traceId")

        export = ChatTelemetryRegisteredExport(d.pop("export"))

        expires_at = datetime.datetime.fromisoformat(d.pop("expiresAt"))

        chat_telemetry_registered = cls(
            trace_id=trace_id,
            export=export,
            expires_at=expires_at,
        )

        return chat_telemetry_registered
