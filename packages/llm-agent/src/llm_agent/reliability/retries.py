"""The one retry policy of the package. Provider SDK and graph retries are disabled.

Only transient failures are retried, within the execution's single retry allowance, deadline and
cost allowance: rate limits, overload and server errors, connection failures and attempt timeouts.
"""

from __future__ import annotations

import anthropic

RETRYABLE_STATUS = frozenset({408, 409, 429})


def is_transient(error: BaseException) -> bool:
    if isinstance(error, TimeoutError | anthropic.APIConnectionError):
        return True
    if isinstance(error, anthropic.APIStatusError):
        return error.status_code in RETRYABLE_STATUS or error.status_code >= 500
    return False


def is_unbilled(error: BaseException) -> bool:
    """A status error response: the provider produced no tokens for the attempt."""
    return isinstance(error, anthropic.APIStatusError)
