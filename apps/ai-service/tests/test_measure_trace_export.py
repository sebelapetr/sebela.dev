"""The repeatable trace-export workload measurement (#214) runs offline and reports every figure.

It is a fictional workload, not the production measurement: these tests only prove the command
runs without a network or a key and reports what S07 has to read on the ARM64 server.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "measure_trace_export.py"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    environment = {key: value for key, value in os.environ.items() if "LANGFUSE" not in key}
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=120,
        env=environment,
        check=False,
    )


def test_the_measurement_reports_versions_memory_cpu_latency_throughput_and_chat_impact() -> None:
    result = _run("--rounds", "3", "--json")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["fictional"] is True
    assert report["detector"] == "none (rules only)"
    assert report["package"]
    assert report["machine"]
    for key in ("cold_ms", "warm_p50_ms", "warm_p95_ms", "texts_per_s"):
        assert report["masking"][key] >= 0, key
    for key in ("before_load", "after_cold", "after_warm"):
        assert report["peak_rss_mb"][key] > 0, key
    assert report["cpu_s"] >= 0
    assert report["export"]["exported"] == report["export"]["traces"] > 0
    assert report["export"]["traces_per_s"] > 0
    for phase in ("without_export", "with_export"):
        chats = report["four_chats"][phase]
        assert chats["chats"] == 4
        for key in ("wall_ms", "loop_lag_p95_ms", "loop_lag_max_ms"):
            assert chats[key] >= 0, key


def test_the_text_report_names_itself_fictional_and_not_the_production_measurement() -> None:
    result = _run("--rounds", "2")
    assert result.returncode == 0, result.stderr
    assert "fictional workload" in result.stdout
    assert "not the production measurement" in result.stdout


def test_a_missing_detector_folder_fails_without_downloading() -> None:
    result = _run("--detector", str(SCRIPT.parent / "no-such-model"), "--rounds", "1")
    assert result.returncode == 1
    assert "detector" in result.stderr


def test_bad_usage_exits_two() -> None:
    assert _run("--rounds", "zero").returncode == 2
