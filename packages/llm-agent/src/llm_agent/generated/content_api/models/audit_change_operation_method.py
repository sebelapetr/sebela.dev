from enum import StrEnum


class AuditChangeOperationMethod(StrEnum):
    DELETE = "DELETE"
    PATCH = "PATCH"
    POST = "POST"

    def __str__(self) -> str:
        return str(self.value)
