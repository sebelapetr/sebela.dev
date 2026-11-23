from enum import StrEnum


class ChatCompactionResultOutcome(StrEnum):
    COMPACTED = "compacted"
    FAILED = "failed"
    UNCHANGED = "unchanged"

    def __str__(self) -> str:
        return str(self.value)
