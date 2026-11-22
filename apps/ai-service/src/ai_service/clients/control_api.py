"""The API's internal control routes: the one-use grant claim and the one result report.

Hand-written over httpx2 and Pydantic; it can move to the generated `sebela_api_client` once
the control routes are in the API's published document. The control bearer is the service's own
credential (`AI_SERVICE_CONTROL_TOKEN`), never a content API key, and never reaches the model.

- `claim` returns the claimed terms, or None for anything else (refused, already claimed,
  expired, a failing API): an unclaimed grant never leads to a model call.
- `report` posts the result until the API stores it, retrying server errors and transport
  failures with a short backoff until `until` (a `time.monotonic()` instant); a 4xx is final.
"""

from __future__ import annotations

import asyncio
import datetime
import time
from dataclasses import dataclass
from typing import Final

import httpx2
from pydantic import ValidationError

from ai_service.schemas import Claimed, ResultReport

_CLAIM_PATH: Final = "/v1/internal/chat/grants/claim"
_FIRST_BACKOFF_S: Final = 0.2
_MAX_BACKOFF_S: Final = 1.0
_MAX_ATTEMPT_S: Final = 3.0
_CLAIM_TIMEOUT_S: Final = 5.0


@dataclass(frozen=True)
class Claim:
    allowance_usd: float
    deadline_at: datetime.datetime
    model: str
    pricing_version: str


class ControlApi:
    def __init__(
        self, base_url: str, token: str, *, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        self._client = httpx2.AsyncClient(
            base_url=base_url,
            transport=transport,
            headers={"authorization": f"Bearer {token}"},
            follow_redirects=False,
        )

    async def claim(
        self, operation_id: str, grant: str, *, timeout_s: float = _CLAIM_TIMEOUT_S
    ) -> Claim | None:
        """The terms of the grant once it is claimed for this operation, otherwise None."""
        try:
            response = await self._client.post(
                _CLAIM_PATH,
                json={"operationId": operation_id, "grant": grant},
                timeout=max(timeout_s, 0.01),
            )
        except httpx2.HTTPError:
            return None
        if response.status_code != 200:
            return None
        try:
            claimed = Claimed.model_validate_json(response.content)
        except ValidationError:
            return None
        return Claim(
            allowance_usd=claimed.allowance_usd,
            deadline_at=claimed.deadline_at,
            model=claimed.model,
            pricing_version=claimed.pricing_version,
        )

    async def report(self, operation_id: str, report: ResultReport, *, until: float) -> bool:
        """True once the API stored the result (or already had one); False when it never did."""
        path = f"/v1/internal/chat/operations/{operation_id}/result"
        body = report.model_dump(mode="json", by_alias=True)
        backoff = _FIRST_BACKOFF_S
        while True:
            remaining = until - time.monotonic()
            if remaining <= 0:
                return False
            try:
                response = await self._client.post(
                    path, json=body, timeout=min(remaining, _MAX_ATTEMPT_S)
                )
            except httpx2.HTTPError:
                response = None
            if response is not None and response.status_code < 500:
                return response.is_success
            remaining = until - time.monotonic()
            if remaining <= 0:
                return False
            await asyncio.sleep(min(backoff, remaining))
            backoff = min(backoff * 2, _MAX_BACKOFF_S)

    async def aclose(self) -> None:
        await self._client.aclose()
