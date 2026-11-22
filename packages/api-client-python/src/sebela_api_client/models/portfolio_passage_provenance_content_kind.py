from enum import StrEnum


class PortfolioPassageProvenanceContentKind(StrEnum):
    BOOK = "book"
    CASE_STUDY = "case_study"
    DIARY_DAY = "diary_day"
    EDUCATION = "education"
    EVENT = "event"
    EXPERIENCE = "experience"
    EXPLORATION = "exploration"
    GLOSSARY_TERM = "glossary_term"
    PROFILE = "profile"
    PROJECT = "project"
    ROADMAP_AREA = "roadmap_area"
    ROADMAP_MODULE = "roadmap_module"
    ROADMAP_RESOURCE = "roadmap_resource"
    SERVICE = "service"

    def __str__(self) -> str:
        return str(self.value)
