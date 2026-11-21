"""The one retry policy of the package. Provider SDK and graph retries are disabled.

Only transient failures are retried, within the execution's single retry allowance, deadline and
cost allowance: rate limits, overload and server errors, connection failures and attempt timeouts.
The one other retry is a reply the stage's validity check rejects (the Security Gateway's invalid
verdict): it uses the same single allowance, deadline and admission, so an execution still has at
most one retry and at most the capped model attempts.
A provider's Retry-After is honoured, but only while it fits the remaining deadline: it can never
extend or reset the common deadline.
"""

from __future__ import annotations

import datetime
import email.utils

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


def retry_after_s(error: BaseException) -> float | None:
    """The wait a status error asks for (`retry-after-ms`, `retry-after` seconds or HTTP date)."""
    if not isinstance(error, anthropic.APIStatusError):
        return None
    headers = error.response.headers
    milliseconds = _number(headers.get("retry-after-ms"))
    if milliseconds is not None:
        return milliseconds / 1000
    value = headers.get("retry-after")
    seconds = _number(value)
    if seconds is not None or value is None:
        return seconds
    try:
        moment = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        return None
    return max((moment - datetime.datetime.now(datetime.UTC)).total_seconds(), 0.0)


def _number(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if number >= 0 and number == number and number != float("inf") else None
