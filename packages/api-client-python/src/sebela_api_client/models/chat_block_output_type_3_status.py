from enum import StrEnum


class ChatBlockOutputType3Status(StrEnum):
    BUILT = "built"
    DESIGNED = "designed"
    TESTED = "tested"

    def __str__(self) -> str:
        return str(self.value)
