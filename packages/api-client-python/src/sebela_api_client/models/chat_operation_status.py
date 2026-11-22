from enum import StrEnum


class ChatOperationStatus(StrEnum):
    ACCEPTED = "accepted"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
