from enum import StrEnum


class EducationKind(StrEnum):
    CERTIFICATION = "certification"
    COURSE = "course"
    MILESTONE = "milestone"
    SCHOOL = "school"

    def __str__(self) -> str:
        return str(self.value)
