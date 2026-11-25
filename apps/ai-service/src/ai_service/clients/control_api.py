"""The API's internal control routes: the one-use grant claim and the one result report.

The only module of this app that imports the generated client (`sebela_api_client`,
packages/api-client-python, generated from the API's OpenAPI document); it calls exactly four of
its operations, `claim_chat_grant`, `report_chat_result`, `report_chat_compaction` and
`register_chat_telemetry`, and uses their generated models (`ChatGrantClaim`, `ChatGrantClaimed`,
`ChatGenerationResult`, `ChatCompactionResult`, `ChatTelemetryRegistration`,
`ChatTelemetryRegistered`). The control bearer is the service's
own credential (`AI_SERVICE_CONTROL_TOKEN`), never a content API key, and never reaches the model.
Redirects are never followed. The status decides before any body is parsed: a response hook ends
every answer but a 200 with `_Answered(status)`, so an unreadable error body (a proxy's page, an
error code this service does not know) can never hide a final 4xx.

- `claim` returns the generated `ChatGrantClaimed`, or None for anything else (refused, already
  claimed, expired, redirected, a failing API, a body outside the contract): an unclaimed grant
  never leads to a model call. The generated parser checks only the shape, so the contract's
  bounds (a literal `claimed`, an aware deadline, a positive allowance, non-empty versions, a
  non-negative integer revision) are checked here.
- `report` posts the result as the generated `ChatGenerationResult` until the API stores it,
  retrying server errors and transport failures with a short backoff until `until` (a
  `time.monotonic()` instant); any other status is final: a 2xx means stored (whatever its body),
  a redirect or a 4xx means never.
- `report_compaction` delivers a compaction's result as the generated `ChatCompactionResult`
  to its own result route under the same rules.
- `register_telemetry` registers one trace of a claimed operation before its export, once and
  without a retry: True only when the API answers `allowed` for exactly this trace; a refusal,
  any other status, a transport failure or a body outside the contract is False, and the trace
  is then never exported.
"""

from __future__ import annotations

import asyncio
import math
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Final

import httpx2
from sebela_api_client import AuthenticatedClient
from sebela_api_client.api.default import (
    claim_chat_grant,
    register_chat_telemetry,
    report_chat_compaction,
    report_chat_result,
)
from sebela_api_client.models import (
    ChatCompactionResult,
    ChatGenerationResult,
    ChatGrantClaim,
    ChatGrantClaimed,
    ChatTelemetryRegistered,
    ChatTelemetryRegisteredExport,
    ChatTelemetryRegistration,
)

from ai_service.schemas import CompactionReport, ResultReport

_FIRST_BACKOFF_S: Final = 0.2
_MAX_BACKOFF_S: Final = 1.0
_MAX_ATTEMPT_S: Final = 3.0
_CLAIM_TIMEOUT_S: Final = 5.0
_MAX_VERSION_CHARS: Final = 100
#: What the generated parsers raise on a body outside the contract.
_UNREADABLE: Final = (KeyError, TypeError, ValueError, AttributeError)


class _Answered(Exception):
    """The API answered with a status other than 200; raised before its body is parsed."""

    def __init__(self, status: int) -> None:
        super().__init__(status)
        self.status = status


async def _only_200_is_parsed(response: httpx2.Response) -> None:
    if response.status_code != 200:
        raise _Answered(response.status_code)


class ControlApi:
    def __init__(
        self, base_url: str, token: str, *, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        self._http = httpx2.AsyncClient(
            base_url=base_url,
            transport=transport,
            headers={"authorization": f"Bearer {token}"},
            timeout=_CLAIM_TIMEOUT_S,
            follow_redirects=False,
            event_hooks={"response": [_only_200_is_parsed]},
        )
        self._client = AuthenticatedClient(
            base_url=base_url, token=token, follow_redirects=False
        ).set_async_httpx_client(self._http)

    async def claim(
        self, operation_id: str, grant: str, *, timeout_s: float = _CLAIM_TIMEOUT_S
    ) -> ChatGrantClaimed | None:
        """The terms of the grant once it is claimed for this operation, otherwise None."""
        body = ChatGrantClaim(operation_id=uuid.UUID(operation_id), grant=grant)
        try:
            async with asyncio.timeout(max(timeout_s, 0.01)):
                response = await claim_chat_grant.asyncio_detailed(client=self._client, body=body)
        except (_Answered, httpx2.HTTPError, TimeoutError, *_UNREADABLE):
            return None
        claimed = response.parsed
        if not isinstance(claimed, ChatGrantClaimed):
            return None
        return claimed if _within_contract(claimed) else None

    async def report(self, operation_id: str, report: ResultReport, *, until: float) -> bool:
        """True once the API stored the result (or already had one); False when it never did."""
        try:
            body = ChatGenerationResult.from_dict(report.model_dump(mode="json", by_alias=True))
        except _UNREADABLE:
            return False
        operation = uuid.UUID(operation_id)

        async def send() -> None:
            await report_chat_result.asyncio_detailed(operation, client=self._client, body=body)

        return await _delivered(send, until)

    async def report_compaction(
        self, operation_id: str, report: CompactionReport, *, until: float
    ) -> bool:
        """True once the API stored the compaction's result; False when it never did."""
        try:
            body = ChatCompactionResult.from_dict(report.model_dump(mode="json", by_alias=True))
        except _UNREADABLE:
            return False
        operation = uuid.UUID(operation_id)

        async def send() -> None:
            await report_chat_compaction.asyncio_detailed(operation, client=self._client, body=body)

        return await _delivered(send, until)

    async def register_telemetry(
        self, operation_id: str, grant: str, trace_id: str, *, timeout_s: float = _CLAIM_TIMEOUT_S
    ) -> bool:
        """True only when the API allows exporting `trace_id` for this operation now."""
        body = ChatTelemetryRegistration(grant=grant, trace_id=trace_id)
        try:
            operation = uuid.UUID(operation_id)
            async with asyncio.timeout(max(timeout_s, 0.01)):
                response = await register_chat_telemetry.asyncio_detailed(
                    operation, client=self._client, body=body
                )
        except (_Answered, httpx2.HTTPError, TimeoutError, *_UNREADABLE):
            return False
        registered = response.parsed
        return (
            isinstance(registered, ChatTelemetryRegistered)
            and registered.trace_id == trace_id
            and registered.export is ChatTelemetryRegisteredExport.ALLOWED
        )

    async def aclose(self) -> None:
        await self._http.aclose()


async def _delivered(send: Callable[[], Awaitable[None]], until: float) -> bool:
    """Sends until the API stores the report: server errors and transport failures are retried
    with a short backoff until `until`; any other status is final."""
    backoff = _FIRST_BACKOFF_S
    while True:
        remaining = until - time.monotonic()
        if remaining <= 0:
            return False
        try:
            async with asyncio.timeout(min(remaining, _MAX_ATTEMPT_S)):
                await send()
            return True
        except _UNREADABLE:
            # The hook let only a 200 through: the API stored the report.
            return True
        except _Answered as answered:
            if answered.status < 500:
                return 200 <= answered.status < 300
        except (httpx2.HTTPError, TimeoutError):
            pass
        remaining = until - time.monotonic()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(backoff, remaining))
        backoff = min(backoff * 2, _MAX_BACKOFF_S)


def _within_contract(claimed: ChatGrantClaimed) -> bool:
    """The bounds of `ChatGrantClaimed` in the API document that the generated parser skips."""
    allowance = claimed.allowance_usd
    revision = claimed.context_revision
    return (
        claimed.claimed is True
        and claimed.deadline_at.utcoffset() is not None
        and isinstance(allowance, int | float)
        and not isinstance(allowance, bool)
        and math.isfinite(allowance)
        and allowance > 0
        and _version(claimed.model)
        and (claimed.effort is None or _version(claimed.effort))
        and _version(claimed.pricing_version)
        and isinstance(revision, int)
        and not isinstance(revision, bool)
        and revision >= 0
    )


def _version(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value) <= _MAX_VERSION_CHARS
