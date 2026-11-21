from enum import StrEnum


class ExplorationCreateStatus(StrEnum):
    BUILT = "built"
    DESIGNED = "designed"
    TESTED = "tested"

    def __str__(self) -> str:
        return str(self.value)
