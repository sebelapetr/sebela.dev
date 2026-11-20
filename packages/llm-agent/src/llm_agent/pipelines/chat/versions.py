"""The identifiers of the agent's behaviour, stored with every result and eval record.

The named fields identify the models, prompts, schemas, tool specifications, guard texts and price
list. `runtime` fingerprints the source of every module of the installed package, so any code
change - guard rules, tool data projections, model settings, limits - also yields new versions and
a stored answer is only regraded against the behaviour that produced it. Changes outside the
package (dependency versions in the lockfile) are covered by `package` only when its version is
bumped.
"""

from __future__ import annotations

import json
from functools import cache
from importlib.metadata import PackageNotFoundError, version
from importlib.resources import files
from importlib.resources.abc import Traversable
from typing import Final

from llm_agent.guardrails.output import GUARD_VERSION
from llm_agent.guardrails.policies import TEXTS
from llm_agent.models.config import PRICING_VERSION, STAGES
from llm_agent.pipelines.chat.stages.main_agent import DRAFT_SCHEMA
from llm_agent.pipelines.chat.stages.security_gateway import VERDICT_SCHEMA
from llm_agent.prompts import CHAT_PROMPT, SECURITY_PROMPT, UNCERTAIN_RESTRICTION, fingerprint
from llm_agent.schemas import Versions
from llm_agent.tools.registry import TOOL_SPECS

PIPELINE_VERSION: Final = "chat-1"


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def _modules(node: Traversable, prefix: str) -> list[tuple[str, Traversable]]:
    found: list[tuple[str, Traversable]] = []
    for child in node.iterdir():
        if child.is_dir():
            if child.name != "__pycache__":
                found.extend(_modules(child, f"{prefix}{child.name}/"))
        elif child.name.endswith(".py"):
            found.append((f"{prefix}{child.name}", child))
    return found


def runtime_sources() -> list[str]:
    """The package-relative paths the runtime fingerprint covers, sorted."""
    return sorted(path for path, _ in _modules(files("llm_agent"), ""))


def _runtime() -> str:
    modules = sorted(_modules(files("llm_agent"), ""), key=lambda item: item[0])
    return fingerprint(*(f"{path}\n{node.read_text(encoding='utf-8')}" for path, node in modules))


@cache
def versions() -> Versions:
    try:
        package = version("llm-agent")
    except PackageNotFoundError:  # pragma: no cover - run from a source tree without metadata
        package = "0.0.0+source"
    return Versions(
        package=package,
        pipeline=PIPELINE_VERSION,
        security_model=STAGES["security"].model,
        security_effort=STAGES["security"].effort,
        main_model=STAGES["main"].model,
        main_effort=STAGES["main"].effort,
        security_prompt=fingerprint(SECURITY_PROMPT, _json(VERDICT_SCHEMA)),
        chat_prompt=fingerprint(CHAT_PROMPT, UNCERTAIN_RESTRICTION, _json(DRAFT_SCHEMA)),
        tools=fingerprint(_json(TOOL_SPECS)),
        output_guard=f"{GUARD_VERSION}+{fingerprint(_json(TEXTS))}",
        runtime=_runtime(),
        pricing=PRICING_VERSION,
    )
