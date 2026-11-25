from enum import StrEnum


class ChatOperationKind(StrEnum):
    ANSWER = "answer"
    COMPACTION = "compaction"

    def __str__(self) -> str:
        return str(self.value)
