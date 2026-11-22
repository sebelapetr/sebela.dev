from enum import StrEnum


class ChatConversationClearedTelemetryDeletion(StrEnum):
    NONE = "none"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
