"""Measures the trace-export workload on fictional data, offline (#214).

    uv run python scripts/measure_trace_export.py [--detector <model-folder>] [--rounds N]
        [--corpus <corpus.json>] [--json]

Reports the masking version (the rules, or the pinned local detector in `<model-folder>`,
loaded through `open_detector`; nothing is downloaded), the package version and machine, the
cold and warm masking latency and throughput over the frozen local corpus, peak RSS before the
detector loads, after the cold pass and after the warm passes, the process CPU time, the
exporter's throughput through a loopback trace store, and four concurrent fictional chats on one
event loop without and with the export running (wall time, event-loop lag).

It is a fictional workload, not the production measurement: S07 runs it on the ARM64 server and
owns the resource-envelope acceptance. No key, network or API is used; exit 1 when the detector
cannot be loaded, 2 for bad usage.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import platform
import re
import resource
import statistics
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx2
from llm_agent import ExecutionRecord, Span, Usage, otlp_trace, versions
from llm_agent.observability.pseudonymization import (
    Detector,
    DetectorUnavailableError,
    Pseudonymizer,
    open_detector,
)

from ai_service.config import Langfuse
from ai_service.runtime.telemetry import TraceExporter

CORPUS = Path(__file__).parents[3] / "packages" / "llm-agent" / "evals" / "pii" / "corpus.json"
CHATS = 4
#: The texts one payload-bearing trace would mask: the question and the answer.
TEXTS_PER_TRACE = 2
_MARK = re.compile(r"\[\[[a-z_]+:(.*?)\]\]")
_TICK_S = 0.005
_TARGET = Langfuse.model_validate(
    {
        "base_url": "https://trace-store.invalid",
        "public_key": "pk-lf-fictional-measure",
        "secret_key": "sk-lf-fictional-measure",
    }
)


def _positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def _arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--detector", type=Path, help="a pinned local detector folder")
    parser.add_argument("--corpus", type=Path, default=CORPUS, help="the frozen local corpus")
    parser.add_argument("--rounds", type=_positive, default=5, help="warm passes and chat rounds")
    parser.add_argument("--json", action="store_true", help="print one JSON object")
    return parser.parse_args(argv)


def _peak_rss_mb() -> float:
    # Linux reports kilobytes.
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def _texts(path: Path) -> list[tuple[str, list[str]]]:
    corpus = json.loads(path.read_text(encoding="utf-8"))
    return [
        (_MARK.sub(r"\1", entry["text"]), list(entry.get("public_facts", [])))
        for entry in corpus["entries"]
    ]


def _record(operation: str) -> ExecutionRecord:
    return ExecutionRecord(
        execution_id=operation,
        trace_id=None,
        operation="answer",
        outcome="answered",
        reason=None,
        language="en",
        usage=Usage(model_attempts=1, input_tokens=900, output_tokens=120, cost_usd=0.004),
        versions=versions(),
        spans=[
            Span(name="stage.main", status="ok", start_ms=0, duration_ms=90),
            Span(
                name="model.main",
                status="ok",
                start_ms=2,
                duration_ms=60,
                attributes={"model": "fictional", "input_tokens": 900, "output_tokens": 120},
            ),
            Span(name="tool.search_content", status="ok", start_ms=64, duration_ms=10),
        ],
    )


def _masking(
    pseudonymizer: Pseudonymizer, texts: list[tuple[str, list[str]]], rounds: int
) -> dict[str, Any]:
    started = time.perf_counter()
    for text, facts in texts:
        pseudonymizer.mask(text, facts)
    cold_ms = (time.perf_counter() - started) * 1000 / len(texts)
    rss_cold = _peak_rss_mb()
    latencies: list[float] = []
    for _ in range(rounds):
        for text, facts in texts:
            began = time.perf_counter()
            pseudonymizer.mask(text, facts)
            latencies.append((time.perf_counter() - began) * 1000)
    total_s = sum(latencies) / 1000
    return {
        "cold_ms": round(cold_ms, 3),
        "warm_p50_ms": round(statistics.median(latencies), 3),
        "warm_p95_ms": round(_percentile(latencies, 95), 3),
        "texts_per_s": round(len(latencies) / total_s, 1) if total_s else 0.0,
        "_rss_cold": rss_cold,
    }


def _percentile(values: list[float], percent: int) -> float:
    if len(values) < 2:
        return values[0] if values else 0.0
    return statistics.quantiles(values, n=100, method="inclusive")[percent - 1]


class _Store:
    def __init__(self) -> None:
        self.received = 0

    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self._handle)

    async def _handle(self, request: httpx2.Request) -> httpx2.Response:
        self.received += 1
        return httpx2.Response(200, json={})


async def _allowed(operation: str, grant: str, trace_id: str) -> bool:
    return True


def _exporter(
    pseudonymizer: Pseudonymizer, texts: list[tuple[str, list[str]]], store: _Store
) -> TraceExporter:
    position = [0]

    def build(record: ExecutionRecord, **options: Any) -> dict[str, Any]:
        # A payload-bearing build: mask what one trace would carry, then build the body.
        for _ in range(TEXTS_PER_TRACE):
            text, facts = texts[position[0] % len(texts)]
            position[0] += 1
            pseudonymizer.mask(text, facts)
        return otlp_trace(record, **options)

    return TraceExporter(
        _TARGET, register=_allowed, transport=store.transport(), queue_size=64, build=build
    )


async def _chat(index: int, round_: int, exporter: TraceExporter | None) -> None:
    operation = f"00000000-0000-4000-8000-{round_:06d}{index:06d}"
    for _ in range(3):
        await asyncio.sleep(0.03)
        json.dumps({"fictional": list(range(200))})
    if exporter is not None:
        exporter.bind(operation, f"grant-fictional-{round_}-{index}")
        exporter.export(_record(operation))
        exporter.release(operation)


async def _four_chats(rounds: int, exporter: TraceExporter | None) -> dict[str, Any]:
    lags: list[float] = []
    stop = asyncio.Event()

    async def tick() -> None:
        while not stop.is_set():
            began = time.perf_counter()
            await asyncio.sleep(_TICK_S)
            lags.append(max((time.perf_counter() - began - _TICK_S) * 1000, 0.0))

    ticker = asyncio.create_task(tick())
    started = time.perf_counter()
    for round_ in range(rounds):
        await asyncio.gather(*(_chat(index, round_, exporter) for index in range(CHATS)))
    wall_ms = (time.perf_counter() - started) * 1000 / rounds
    stop.set()
    await ticker
    return {
        "chats": CHATS,
        "wall_ms": round(wall_ms, 1),
        "loop_lag_p95_ms": round(_percentile(lags, 95), 3),
        "loop_lag_max_ms": round(max(lags, default=0.0), 3),
    }


async def _export(
    pseudonymizer: Pseudonymizer, texts: list[tuple[str, list[str]]], rounds: int
) -> tuple[dict[str, Any], dict[str, Any]]:
    without = await _four_chats(rounds, None)
    store = _Store()
    exporter = _exporter(pseudonymizer, texts, store)
    exporter.start()
    started = time.perf_counter()
    with_export = await _four_chats(rounds, exporter)
    await exporter.shutdown(60.0)
    elapsed = time.perf_counter() - started
    traces = rounds * CHATS
    exported = exporter.counts["exported"]
    export = {
        "traces": traces,
        "exported": exported,
        "dropped": {key: value for key, value in exporter.counts.items() if key != "exported"},
        "traces_per_s": round(exported / elapsed, 1) if elapsed else 0.0,
    }
    return export, {"without_export": without, "with_export": with_export}


def measure(detector_folder: Path | None, corpus: Path, rounds: int) -> dict[str, Any]:
    cpu_started = time.process_time()
    rss_before = _peak_rss_mb()
    detector: Detector | None = None
    if detector_folder is not None:
        detector = open_detector(detector_folder)
    pseudonymizer = Pseudonymizer(detector)
    texts = _texts(corpus)
    masking = _masking(pseudonymizer, texts, rounds)
    rss_cold = masking.pop("_rss_cold")
    rss_warm = _peak_rss_mb()
    export, chats = asyncio.run(_export(pseudonymizer, texts, rounds))
    return {
        "fictional": True,
        "detector": detector.version if detector is not None else "none (rules only)",
        "masking_version": pseudonymizer.version,
        "package": versions().package,
        "machine": platform.machine(),
        "python": platform.python_version(),
        "corpus_texts": len(texts),
        "rounds": rounds,
        "masking": masking,
        "peak_rss_mb": {
            "before_load": round(rss_before, 1),
            "after_cold": round(rss_cold, 1),
            "after_warm": round(rss_warm, 1),
        },
        "cpu_s": round(time.process_time() - cpu_started, 3),
        "export": export,
        "four_chats": chats,
    }


def _text(report: dict[str, Any]) -> str:
    masking, rss, export = report["masking"], report["peak_rss_mb"], report["export"]
    lines = [
        "fictional workload on fictional data; not the production measurement (S07)",
        f"detector: {report['detector']}; masking {report['masking_version']}; "
        f"llm-agent {report['package']}; {report['machine']}, Python {report['python']}",
        f"masking {report['corpus_texts']} texts x {report['rounds']}: cold "
        f"{masking['cold_ms']} ms/text, warm p50 {masking['warm_p50_ms']} ms, p95 "
        f"{masking['warm_p95_ms']} ms, {masking['texts_per_s']} texts/s",
        f"peak RSS: {rss['before_load']} MB before load, {rss['after_cold']} MB after cold, "
        f"{rss['after_warm']} MB after warm; CPU {report['cpu_s']} s",
        f"export: {export['exported']}/{export['traces']} traces, {export['traces_per_s']}/s, "
        f"dropped {export['dropped'] or 'none'}",
    ]
    for phase, chats in report["four_chats"].items():
        lines.append(
            f"{chats['chats']} chats {phase.replace('_', ' ')}: {chats['wall_ms']} ms per round, "
            f"loop lag p95 {chats['loop_lag_p95_ms']} ms, max {chats['loop_lag_max_ms']} ms"
        )
    return "\n".join(lines)


def main(argv: Sequence[str]) -> int:
    arguments = _arguments(argv)
    try:
        report = measure(arguments.detector, arguments.corpus, arguments.rounds)
    except DetectorUnavailableError as error:
        sys.stderr.write(f"detector unavailable: {error}\n")
        return 1
    print(json.dumps(report, indent=2) if arguments.json else _text(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
