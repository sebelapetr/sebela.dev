from enum import StrEnum


class LearningTimeEventKind(StrEnum):
    CONFERENCE = "conference"
    LECTURE = "lecture"
    MEETUP = "meetup"
    WORKSHOP = "workshop"

    def __str__(self) -> str:
        return str(self.value)
