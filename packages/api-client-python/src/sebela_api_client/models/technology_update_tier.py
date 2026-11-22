from enum import StrEnum


class TechnologyUpdateTier(StrEnum):
    PRIMARY = "primary"
    SECONDARY = "secondary"

    def __str__(self) -> str:
        return str(self.value)
