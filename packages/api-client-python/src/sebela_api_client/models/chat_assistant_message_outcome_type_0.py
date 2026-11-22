from enum import StrEnum


class ChatAssistantMessageOutcomeType0(StrEnum):
    ANSWERED = "answered"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    REFUSED = "refused"
    UNAVAILABLE = "unavailable"

    def __str__(self) -> str:
        return str(self.value)
