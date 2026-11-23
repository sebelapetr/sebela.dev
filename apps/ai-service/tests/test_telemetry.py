"""The trace exporter (#214): register first, export only on `allowed`, bounded, never blocking.

Every outbound request is captured whole by the fictional trace store, so these tests check the
payload that would leave, not a masking helper. All keys, hosts and values are fictional.
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
import threading
import time
from typing import Any

import pytest
from llm_agent import ExecutionRecord, Span, Usage, otlp_trace, versions

from ai_service.config import Langfuse
from ai_service.runtime.telemetry import EXPORT_WINDOW_S, TraceExporter
from tests.fakes import LANGFUSE_PUBLIC, LANGFUSE_SECRET, LANGFUSE_URL, FakeLangfuse

OPERATION = "00000000-0000-4000-8000-0000000000a1"
GRANT = "grant-fictional-0000-1111"
TARGET = Langfuse.model_validate(
    {"base_url": LANGFUSE_URL, "public_key": LANGFUSE_PUBLIC, "secret_key": LANGFUSE_SECRET}
)

#: Values no export may ever carry: the grant, the operation, keys, a cookie, an IP, an email.
FORBIDDEN = (
    GRANT,
    OPERATION,
    LANGFUSE_SECRET,
    "session=fictional-cookie",
    "203.0.113.42",
    "daniel.okafor@northwind.example.com",
    "sk-ant-api03-Zx9fakefakefakefakefakeFAKE00",
)


def record(operation: str | None = OPERATION, **fields: Any) -> ExecutionRecord:
    values: dict[str, Any] = {
        "execution_id": operation,
        "trace_id": None,
        "operation": "answer",
        "outcome": "answered",
        "reason": None,
        "language": "en",
        "usage": Usage(model_attempts=1, input_tokens=900, output_tokens=120, cost_usd=0.004),
        "versions": versions(),
        "spans": [
            Span(name="stage.main", status="ok", start_ms=0, duration_ms=40),
            Span(
                name="model.main",
                status="ok",
                start_ms=2,
                duration_ms=30,
                attributes={
                    "model": "claude-haiku-5-5",
                    "input_tokens": 900,
                    "output_tokens": 120,
                    "cookie": "session=fictional-cookie",
                    "client_ip": "203.0.113.42",
                    "grant": GRANT,
                    "outcome": "mail daniel.okafor@northwind.example.com, "
                    "key sk-ant-api03-Zx9fakefakefakefakefakeFAKE00",
                },
            ),
        ],
    }
    values.update(fields)
    return ExecutionRecord(**values)


class Registrar:
    """The API's registration as the exporter sees it: scripted answers, every call recorded."""

    def __init__(self, allowed: bool = True, delay_s: float = 0.0) -> None:
        self.allowed = allowed
        self.delay_s = delay_s
        self.calls: list[tuple[str, str, str]] = []

    async def __call__(self, operation: str, grant: str, trace_id: str) -> bool:
        self.calls.append((operation, grant, trace_id))
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        return self.allowed


def exporter(store: FakeLangfuse, registrar: Registrar, **options: Any) -> TraceExporter:
    return TraceExporter(TARGET, register=registrar, transport=store.transport(), **options)


async def settle(item: TraceExporter, timeout_s: float = 5.0) -> None:
    await item.shutdown(timeout_s)


async def test_an_allowed_trace_is_registered_first_and_then_posted_to_langfuse() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    ((operation, grant, trace_id),) = registrar.calls
    assert (operation, grant) == (OPERATION, GRANT)
    (request,) = store.requests
    assert request.method == "POST"
    assert str(request.url) == f"{LANGFUSE_URL}/api/public/otel/v1/traces"
    credentials = base64.b64encode(f"{LANGFUSE_PUBLIC}:{LANGFUSE_SECRET}".encode()).decode()
    assert request.headers["authorization"] == f"Basic {credentials}"
    assert request.headers["x-langfuse-ingestion-version"] == "4"
    assert request.headers["content-type"] == "application/json"
    body = json.loads(request.content)
    spans = body["resourceSpans"][0]["scopeSpans"][0]["spans"]
    assert {span["traceId"] for span in spans} == {trace_id}
    assert item.counts["exported"] == 1


async def test_the_whole_outbound_request_carries_no_secret_grant_operation_or_pii() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    (request,) = store.requests
    body = request.content.decode()
    headers = json.dumps(dict(request.headers))
    for value in FORBIDDEN:
        assert value not in body
    for value in FORBIDDEN:
        assert value not in headers
    assert '"degraded"' in body or "langfuse.trace.metadata.degraded" in body
    attributes = {
        attribute["key"]: attribute["value"]["stringValue"]
        for attribute in json.loads(body)["resourceSpans"][0]["scopeSpans"][0]["spans"][0][
            "attributes"
        ]
    }
    assert attributes["langfuse.trace.metadata.export_mode"] == "metadata"
    assert attributes["langfuse.trace.metadata.degraded"] == "no_detector"
    assert attributes["langfuse.environment"] == "development"


async def test_no_tracing_sdk_is_loaded_so_no_alternate_export_path_exists() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    assert len(store.requests) == 1
    loaded = [name for name in sys.modules if name.split(".")[0] in ("langfuse", "opentelemetry")]
    assert loaded == []


async def test_a_refused_registration_exports_nothing() -> None:
    store, registrar = FakeLangfuse(), Registrar(allowed=False)
    item = exporter(store, registrar)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    assert len(registrar.calls) == 1
    assert store.requests == []
    assert item.counts["refused"] == 1


async def test_a_record_without_a_bound_grant_is_dropped_unregistered() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    item.start()
    item.export(record())
    item.export(record(operation=None))
    item.bind(OPERATION, GRANT)
    item.release(OPERATION)
    item.export(record())
    await settle(item)
    assert registrar.calls == []
    assert store.requests == []
    assert item.counts["unbound"] == 3


async def test_a_grant_is_used_for_one_record_only() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    item.export(record())
    await settle(item)
    assert len(registrar.calls) == 1
    assert item.counts["unbound"] == 1


async def test_a_record_without_spans_is_not_exported() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record(spans=[]))
    await settle(item)
    assert registrar.calls == []
    assert item.counts["empty"] == 1


@pytest.mark.parametrize(
    ("failure", "count"),
    [(429, "rate_limited"), (503, "send_failed"), (0, "send_failed"), (401, "send_failed")],
)
async def test_a_failing_trace_store_drops_the_trace_and_the_next_one_still_goes(
    failure: int, count: str
) -> None:
    store, registrar = FakeLangfuse(failures=[failure]), Registrar()
    item = exporter(store, registrar)
    item.start()
    second = "00000000-0000-4000-8000-0000000000a2"
    item.bind(OPERATION, GRANT)
    item.bind(second, "grant-fictional-2")
    item.export(record())
    item.export(record(operation=second))
    await settle(item)
    # Never retried: a dropped trace is not sent again, the next one is.
    assert len(store.requests) == 2
    assert item.counts[count] == 1
    assert item.counts["exported"] == 1


async def test_export_never_blocks_and_a_full_queue_drops_and_counts() -> None:
    store, registrar = FakeLangfuse(), Registrar(delay_s=0.3)
    item = exporter(store, registrar, queue_size=2)
    item.start()
    operations = [f"00000000-0000-4000-8000-0000000001{index:02d}" for index in range(6)]
    for operation in operations:
        item.bind(operation, f"grant-{operation}")
    started = time.monotonic()
    for operation in operations:
        item.export(record(operation=operation))
    assert time.monotonic() - started < 0.05
    await settle(item)
    assert item.counts["queue_full"] >= 3
    assert item.counts["exported"] + item.counts["queue_full"] == 6


async def test_a_build_that_overruns_its_bound_is_dropped() -> None:
    store, registrar = FakeLangfuse(), Registrar()

    def slow(*args: Any, **kwargs: Any) -> dict[str, Any]:
        time.sleep(0.5)
        return {}

    item = exporter(store, registrar, build_timeout_s=0.05, build=slow)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    assert store.requests == []
    assert item.counts["build_failed"] == 1


async def test_a_build_that_raises_is_dropped_without_registration() -> None:
    store, registrar = FakeLangfuse(), Registrar()

    def broken(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("fictional detector crash")

    item = exporter(store, registrar, build=broken)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    assert registrar.calls == []
    assert store.requests == []
    assert item.counts["build_failed"] == 1


async def test_masking_runs_off_the_event_loop_one_job_at_a_time() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    threads: set[int] = set()
    running: list[int] = []
    overlap: list[bool] = []
    loop_thread = threading.get_ident()

    def build(*args: Any, **kwargs: Any) -> dict[str, Any]:
        threads.add(threading.get_ident())
        running.append(1)
        overlap.append(len(running) > 1)
        time.sleep(0.01)
        running.pop()
        return otlp_trace(*args, **kwargs)

    item = exporter(store, registrar, build=build)
    item.start()
    for index in range(3):
        operation = f"00000000-0000-4000-8000-0000000002{index:02d}"
        item.bind(operation, f"grant-{index}")
        item.export(record(operation=operation))
    await settle(item)
    assert loop_thread not in threads
    assert len(threads) == 1
    assert not any(overlap)
    assert item.counts["exported"] == 3


async def test_a_registration_older_than_the_export_window_is_not_posted() -> None:
    store = FakeLangfuse()
    now = [1000.0]
    registrar = Registrar()

    async def late(operation: str, grant: str, trace_id: str) -> bool:
        await registrar(operation, grant, trace_id)
        now[0] += EXPORT_WINDOW_S
        return True

    def clock() -> float:
        return now[0]

    item = TraceExporter(TARGET, register=late, transport=store.transport(), clock=clock)
    item.start()
    item.bind(OPERATION, GRANT)
    item.export(record())
    await settle(item)
    assert len(registrar.calls) == 1
    assert store.requests == []
    assert item.counts["expired"] == 1


async def test_shutdown_is_bounded_while_the_trace_store_hangs() -> None:
    store, registrar = FakeLangfuse(delay_s=30.0), Registrar()
    item = exporter(store, registrar)
    item.start()
    for index in range(3):
        operation = f"00000000-0000-4000-8000-0000000003{index:02d}"
        item.bind(operation, f"grant-{index}")
        item.export(record(operation=operation))
    await store.wait()
    started = time.monotonic()
    await item.shutdown(0.2)
    assert time.monotonic() - started < 1.0
    assert item.counts["shutdown"] >= 1
    item.export(record())
    assert item.counts["closed"] == 1


async def test_the_bound_grants_cannot_grow_without_limit() -> None:
    store, registrar = FakeLangfuse(), Registrar()
    item = exporter(store, registrar)
    for index in range(1000):
        item.bind(f"operation-{index}", f"grant-{index}")
    assert item.bound <= 64
    await settle(item)
