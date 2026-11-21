from enum import StrEnum


class AuditChangeAction(StrEnum):
    CREATED = "created"
    DELETED = "deleted"
    UPDATED = "updated"

    def __str__(self) -> str:
        return str(self.value)
