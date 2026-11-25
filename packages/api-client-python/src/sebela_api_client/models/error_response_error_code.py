from enum import StrEnum


class ErrorResponseErrorCode(StrEnum):
    BUDGET_EXHAUSTED = "budget_exhausted"
    CHAT_BUDGET_EXHAUSTED = "chat_budget_exhausted"
    CHAT_BUSY = "chat_busy"
    CHAT_CHALLENGE_FAILED = "chat_challenge_failed"
    CHAT_NOT_RETRYABLE = "chat_not_retryable"
    CHAT_QUOTA_EXCEEDED = "chat_quota_exceeded"
    CHAT_REQUEST_CONFLICT = "chat_request_conflict"
    CONFLICT = "conflict"
    CREDENTIALS_IN_URL = "credentials_in_url"
    FORBIDDEN = "forbidden"
    INTERNAL_ERROR = "internal_error"
    MALFORMED_JSON = "malformed_json"
    NOT_FOUND = "not_found"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    RATE_LIMITED = "rate_limited"
    UNAUTHORIZED = "unauthorized"
    UNAVAILABLE = "unavailable"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    VALIDATION_FAILED = "validation_failed"

    def __str__(self) -> str:
        return str(self.value)
