"""The identifiers of the agent's behaviour, stored with every result and eval record.

Each prompt, schema, tool and policy change produces a new fingerprint, so a stored answer is only
regraded against the behaviour that produced it.
"""

from __future__ import annotations

import json
from functools import cache
from importlib.metadata import PackageNotFoundError, version
from typing import Final

from llm_agent.guardrails.output import GUARD_VERSION
from llm_agent.guardrails.policies import TEXTS
from llm_agent.models.config import STAGES
from llm_agent.pipelines.chat.stages.main_agent import DRAFT_SCHEMA
from llm_agent.pipelines.chat.stages.security_gateway import VERDICT_SCHEMA
from llm_agent.prompts import CHAT_PROMPT, SECURITY_PROMPT, UNCERTAIN_RESTRICTION, fingerprint
from llm_agent.schemas import Versions
from llm_agent.tools.registry import TOOL_SPECS

PIPELINE_VERSION: Final = "chat-1"


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


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
    )
