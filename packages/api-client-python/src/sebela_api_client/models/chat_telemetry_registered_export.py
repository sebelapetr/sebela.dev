from enum import StrEnum


class ChatTelemetryRegisteredExport(StrEnum):
    ALLOWED = "allowed"
    REFUSED = "refused"

    def __str__(self) -> str:
        return str(self.value)
