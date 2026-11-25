from enum import StrEnum


class ExperienceUpdateKind(StrEnum):
    MAIN_JOB = "main_job"
    OWN_BUSINESS = "own_business"
    SIDE_PROJECT = "side_project"

    def __str__(self) -> str:
        return str(self.value)
