from enum import StrEnum


class ExplorationUpdateStatus(StrEnum):
    BUILT = "built"
    DESIGNED = "designed"
    TESTED = "tested"

    def __str__(self) -> str:
        return str(self.value)
