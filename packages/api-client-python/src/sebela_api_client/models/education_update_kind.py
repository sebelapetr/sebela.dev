from enum import StrEnum


class EducationUpdateKind(StrEnum):
    CERTIFICATION = "certification"
    COURSE = "course"
    MILESTONE = "milestone"
    SCHOOL = "school"

    def __str__(self) -> str:
        return str(self.value)
