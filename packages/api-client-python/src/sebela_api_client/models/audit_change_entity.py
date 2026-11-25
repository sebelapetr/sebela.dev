from enum import StrEnum


class AuditChangeEntity(StrEnum):
    CASE_STUDY = "case-study"
    CURRENT_FOCUS = "current-focus"
    EDUCATION = "education"
    EXPERIENCE = "experience"
    EXPLORATION = "exploration"
    MEDIA = "media"
    ORGANIZATION = "organization"
    PERSON = "person"
    PROJECT = "project"
    ROADMAP_AREA = "roadmap-area"
    ROADMAP_BOOK = "roadmap-book"
    ROADMAP_DIARY = "roadmap-diary"
    ROADMAP_EVENT = "roadmap-event"
    ROADMAP_FOLLOWED_SOURCE = "roadmap-followed-source"
    ROADMAP_GLOSSARY_TERM = "roadmap-glossary-term"
    ROADMAP_MODULE = "roadmap-module"
    ROADMAP_PROJECT_IDEA = "roadmap-project-idea"
    ROADMAP_RESOURCE = "roadmap-resource"
    ROADMAP_TIME_ENTRY = "roadmap-time-entry"
    SERVICE = "service"
    TECHNOLOGY = "technology"
    TESTIMONIAL = "testimonial"
    TOPIC = "topic"

    def __str__(self) -> str:
        return str(self.value)
