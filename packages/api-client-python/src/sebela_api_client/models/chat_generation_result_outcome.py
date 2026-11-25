from enum import StrEnum


class ChatGenerationResultOutcome(StrEnum):
    ANSWERED = "answered"
    CANCELLED = "cancelled"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    LIMIT_REACHED = "limit_reached"
    REFUSED = "refused"
    UNAVAILABLE = "unavailable"

    def __str__(self) -> str:
        return str(self.value)
