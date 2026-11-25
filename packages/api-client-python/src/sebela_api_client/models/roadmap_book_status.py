from enum import StrEnum


class RoadmapBookStatus(StrEnum):
    COMPLETED = "completed"
    READING = "reading"
    TO_READ = "to-read"

    def __str__(self) -> str:
        return str(self.value)
