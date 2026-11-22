from enum import StrEnum


class ChatAssistantMessageErrorType0Code(StrEnum):
    CANCELLED = "cancelled"
    INTERNAL = "internal"
    INVALID_REQUEST = "invalid_request"
    INVALID_STREAM = "invalid_stream"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    UNAVAILABLE = "unavailable"

    def __str__(self) -> str:
        return str(self.value)
