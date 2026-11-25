from enum import StrEnum


class ChatGrantClaimedKind(StrEnum):
    ANSWER = "answer"
    COMPACTION = "compaction"

    def __str__(self) -> str:
        return str(self.value)
