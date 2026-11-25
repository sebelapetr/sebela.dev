from enum import StrEnum


class ChatUsageRestrictionType0Reason(StrEnum):
    DAY = "day"
    MINUTE = "minute"
    SERVICE_BUDGET = "service_budget"
    SHARED_NETWORK = "shared_network"
    TWO_HOURS = "two_hours"

    def __str__(self) -> str:
        return str(self.value)
