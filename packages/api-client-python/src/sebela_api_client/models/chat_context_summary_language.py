from enum import StrEnum


class ChatContextSummaryLanguage(StrEnum):
    CS = "cs"
    EN = "en"

    def __str__(self) -> str:
        return str(self.value)
