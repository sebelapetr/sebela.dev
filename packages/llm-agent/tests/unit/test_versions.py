"""The behaviour fingerprints that decide whether a stored eval answer may be regraded."""

from __future__ import annotations

from importlib.resources import files

from llm_agent import versions
from llm_agent.pipelines.chat.versions import runtime_sources


def _package_modules() -> set[str]:
    root = files("llm_agent")
    found: set[str] = set()

    def walk(node: object, prefix: str) -> None:
        for child in node.iterdir():  # type: ignore[attr-defined]
            if child.is_dir():
                if child.name != "__pycache__":
                    walk(child, f"{prefix}{child.name}/")
            elif child.name.endswith(".py"):
                found.add(f"{prefix}{child.name}")

    walk(root, "")
    return found


def test_the_runtime_fingerprint_covers_every_module_of_the_package() -> None:
    covered = set(runtime_sources())
    assert covered == _package_modules()
    # The guard rules, the tool projections and the model settings are all inside it.
    assert {"guardrails/output.py", "tools/registry.py", "models/gateway.py"} <= covered


def test_the_versions_name_the_runtime_and_the_pricing() -> None:
    current = versions()
    assert len(current.runtime) == 12
    assert current.pricing == "anthropic-2026-11-19"
    assert current.output_guard.startswith("output-guard-3+")
