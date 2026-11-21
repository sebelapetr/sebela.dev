from enum import StrEnum


class RoadmapProgressStatus(StrEnum):
    COMPLETED = "completed"
    IN_PROGRESS = "in-progress"
    PLANNED = "planned"

    def __str__(self) -> str:
        return str(self.value)
