from enum import StrEnum


class ChatAssistantMessageStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
