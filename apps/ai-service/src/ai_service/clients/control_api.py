"""The API control client (stub)."""

from __future__ import annotations

import datetime
from dataclasses import dataclass

import httpx2

from ai_service.schemas import ResultReport


@dataclass(frozen=True)
class Claim:
    allowance_usd: float
    deadline_at: datetime.datetime


class ControlApi:
    def __init__(
        self, base_url: str, token: str, *, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        raise NotImplementedError(base_url, token, transport)

    async def claim(self, operation_id: str, grant: str) -> Claim | None:
        raise NotImplementedError(operation_id, grant)

    async def report(self, operation_id: str, report: ResultReport, *, until: float) -> bool:
        raise NotImplementedError(operation_id, report, until)

    async def aclose(self) -> None:
        raise NotImplementedError
