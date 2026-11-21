from enum import StrEnum


class TechnologyCreateGroupType0(StrEnum):
    AI_ENGINEERING_FOCUS = "ai_engineering_focus"
    CORE = "core"

    def __str__(self) -> str:
        return str(self.value)
