from enum import StrEnum


class ChatGenerationResultLanguage(StrEnum):
    CS = "cs"
    EN = "en"

    def __str__(self) -> str:
        return str(self.value)
