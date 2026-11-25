from enum import StrEnum


class TechnologyCreateTier(StrEnum):
    PRIMARY = "primary"
    SECONDARY = "secondary"

    def __str__(self) -> str:
        return str(self.value)
