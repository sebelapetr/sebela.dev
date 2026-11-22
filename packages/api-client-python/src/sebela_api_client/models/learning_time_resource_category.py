from enum import StrEnum


class LearningTimeResourceCategory(StrEnum):
    BOOK = "book"
    RESOURCE = "resource"

    def __str__(self) -> str:
        return str(self.value)
