"""The trace export to Langfuse: registered with the API first, bounded, never in an answer's way.

`TraceExporter` is the agent's `TelemetrySink`. `Generations` binds an operation's grant once the
grant is claimed (`bind`) and releases it when the operation ends (`release`); the agent hands
over the operation's redacted record before its result returns (`export`). Each bound grant
serves one record. The exporter then, on its own worker task:

1. builds the metadata-only OTLP body (`llm_agent.otlp_trace`) in a single-thread executor, so at
   most one masking job runs at a time and never on the event loop, within `build_timeout_s`;
2. registers a fresh random trace identifier with the API (`register`); only `allowed` lets the
   trace go, so a conversation deleted meanwhile (a tombstone) is never exported late;
3. posts it to `{base}/api/public/otel/v1/traces` within the API's export window, once, under
   Basic authentication with the project keys, redirects never followed, the whole request
   bounded by `send_timeout_s`.

Every degraded path drops the trace and counts it under a fixed name (`counts`), never retries and
never raises into the agent: a record without a bound grant (`unbound`) or spans (`empty`), a full
queue (`queue_full`), a failing or overrunning build (`build_failed`), a refused or failed
registration (`refused`), a registration older than the window allows (`expired`), a 429
(`rate_limited`), any other failure of the store (`send_failed`), a record after shutdown
(`closed`) and what shutdown leaves (`shutdown`). Nothing is spooled: what is dropped is gone.

No detector has passed the frozen local corpus, so every trace says `degraded=no_detector` and
carries metadata only (`packages/llm-agent/AGENTS.md`, Trace pseudonymization).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import time
from collections import Counter, OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from typing import Any, Final, Protocol

import httpx2
from llm_agent import ExecutionRecord, otlp_trace

from ai_service.config import Langfuse

#: How long after its registration the API lets a trace be exported.
EXPORT_WINDOW_S: Final = 600.0
#: The service name every trace carries as its only resource attribute.
SERVICE: Final = "sebela-ai-service"
#: Why every trace is metadata only: no detector is accepted yet.
DEGRADED: Final = "no_detector"
_INGESTION_PATH: Final = "/api/public/otel/v1/traces"
#: How many operations may hold a bound grant at once (four run at most).
_MAX_BOUND: Final = 64
_REGISTER_TIMEOUT_S: Final = 5.0

_log = logging.getLogger("ai_service.telemetry")

Register = Callable[[str, str, str], Awaitable[bool]]


class Build(Protocol):
    def __call__(
        self,
        record: ExecutionRecord,
        *,
        trace_id: str,
        ended_at_ns: int,
        service: str,
        environment: str,
        degraded: str | None = None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class _Job:
    record: ExecutionRecord
    grant: str
    ended_at_ns: int


class TraceExporter:
    def __init__(
        self,
        target: Langfuse,
        *,
        register: Register,
        transport: httpx2.AsyncBaseTransport | None = None,
        queue_size: int = 16,
        build_timeout_s: float = 2.0,
        send_timeout_s: float = 10.0,
        build: Build = otlp_trace,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._target = target
        self._register = register
        self._build = build
        self._build_timeout_s = build_timeout_s
        self._send_timeout_s = send_timeout_s
        self._clock = clock
        self._queue: asyncio.Queue[_Job] = asyncio.Queue(maxsize=queue_size)
        self._grants: OrderedDict[str, str] = OrderedDict()
        self._counts: Counter[str] = Counter()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trace-mask")
        self._worker: asyncio.Task[None] | None = None
        self._closed = False
        self._http = httpx2.AsyncClient(
            base_url=target.base_url,
            transport=transport,
            auth=httpx2.BasicAuth(target.public_key, target.secret_key.get_secret_value()),
            headers={"x-langfuse-ingestion-version": "4"},
            timeout=send_timeout_s,
            follow_redirects=False,
        )

    @property
    def counts(self) -> Mapping[str, int]:
        """How many traces went (`exported`) and how many were dropped, by reason."""
        return self._counts

    @property
    def bound(self) -> int:
        return len(self._grants)

    def start(self) -> None:
        if self._worker is None and not self._closed:
            self._worker = asyncio.create_task(self._work())

    def bind(self, operation_id: str, grant: str) -> None:
        """Lets the next record of `operation_id` register under its claimed `grant`."""
        self._grants[operation_id] = grant
        self._grants.move_to_end(operation_id)
        while len(self._grants) > _MAX_BOUND:
            self._grants.popitem(last=False)

    def release(self, operation_id: str) -> None:
        self._grants.pop(operation_id, None)

    def export(self, record: ExecutionRecord) -> None:
        """Enqueues `record` without blocking; drops it (counted) when it cannot go."""
        if self._closed:
            self._drop("closed")
            return
        grant = self._grants.pop(record.execution_id, None) if record.execution_id else None
        if grant is None:
            self._drop("unbound")
            return
        if not record.spans:
            self._drop("empty")
            return
        try:
            self._queue.put_nowait(_Job(record, grant, time.time_ns()))
        except asyncio.QueueFull:
            self._drop("queue_full")

    async def shutdown(self, timeout_s: float) -> None:
        """Stops accepting, lets queued traces go within `timeout_s`, then drops the rest."""
        self._closed = True
        self._grants.clear()
        worker = self._worker
        if worker is not None:
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(max(timeout_s, 0.0)):
                    await self._queue.join()
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        while not self._queue.empty():
            self._queue.get_nowait()
            self._queue.task_done()
            self._drop("shutdown")
        self._pool.shutdown(wait=False, cancel_futures=True)
        await self._http.aclose()

    def _drop(self, reason: str) -> None:
        self._counts[reason] += 1
        _log.warning("trace dropped: %s", reason)

    async def _work(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                await self._send(job)
            except asyncio.CancelledError:
                self._drop("shutdown")
                raise
            except Exception:
                self._drop("send_failed")
            finally:
                self._queue.task_done()

    async def _send(self, job: _Job) -> None:
        trace_id = _trace_id()
        build = partial(
            self._build,
            job.record,
            trace_id=trace_id,
            ended_at_ns=job.ended_at_ns,
            service=SERVICE,
            environment=self._target.environment,
            degraded=DEGRADED,
        )
        try:
            async with asyncio.timeout(self._build_timeout_s):
                body = await asyncio.get_running_loop().run_in_executor(self._pool, build)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._drop("build_failed")
            return
        operation = job.record.execution_id or ""
        registered_at = self._clock()
        async with asyncio.timeout(_REGISTER_TIMEOUT_S + 1):
            allowed = await self._register(operation, job.grant, trace_id)
        if not allowed:
            self._drop("refused")
            return
        if self._clock() - registered_at > EXPORT_WINDOW_S - self._send_timeout_s:
            self._drop("expired")
            return
        try:
            async with asyncio.timeout(self._send_timeout_s):
                response = await self._http.post(_INGESTION_PATH, json=body)
        except (httpx2.HTTPError, TimeoutError):
            self._drop("send_failed")
            return
        if response.status_code == 429:
            self._drop("rate_limited")
        elif 200 <= response.status_code < 300:
            self._counts["exported"] += 1
        else:
            self._drop("send_failed")


def _trace_id() -> str:
    while (value := secrets.token_hex(16)) == "0" * 32:
        pass
    return value
