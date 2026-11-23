from enum import StrEnum


class ChatSummaryReferenceKind(StrEnum):
    BOOK = "book"
    CONTACT = "contact"
    CURRENT_FOCUS = "current_focus"
    DIARY_DAY = "diary_day"
    EDUCATION = "education"
    EVENT = "event"
    EXPERIENCE = "experience"
    EXPLORATION = "exploration"
    PROFILE = "profile"
    PROJECT = "project"
    ROADMAP = "roadmap"
    ROADMAP_AREA = "roadmap_area"
    ROADMAP_MODULE = "roadmap_module"
    SERVICE = "service"
    STATISTICS = "statistics"

    def __str__(self) -> str:
        return str(self.value)
