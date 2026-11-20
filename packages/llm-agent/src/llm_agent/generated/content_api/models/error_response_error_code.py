from enum import StrEnum


class ErrorResponseErrorCode(StrEnum):
    CONFLICT = "conflict"
    CREDENTIALS_IN_URL = "credentials_in_url"
    INTERNAL_ERROR = "internal_error"
    MALFORMED_JSON = "malformed_json"
    NOT_FOUND = "not_found"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    RATE_LIMITED = "rate_limited"
    UNAUTHORIZED = "unauthorized"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    VALIDATION_FAILED = "validation_failed"

    def __str__(self) -> str:
        return str(self.value)
