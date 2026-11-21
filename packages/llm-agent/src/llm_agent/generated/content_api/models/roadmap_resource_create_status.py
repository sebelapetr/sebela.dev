from enum import StrEnum


class RoadmapResourceCreateStatus(StrEnum):
    COMPLETED = "completed"
    IN_PROGRESS = "in-progress"
    PAUSED = "paused"
    PLANNED = "planned"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
