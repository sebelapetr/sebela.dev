from enum import StrEnum


class ChatSourceOutputRecordKind(StrEnum):
    EXPERIENCE = "experience"
    EXPLORATION = "exploration"
    PERSON = "person"
    PROJECT = "project"
    ROADMAP_ITEM = "roadmap_item"
    SERVICE = "service"
    TECHNOLOGY_GROUP = "technology_group"

    def __str__(self) -> str:
        return str(self.value)
