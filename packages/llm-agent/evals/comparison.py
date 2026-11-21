"""The Main-model comparison (not implemented yet)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from llm_agent.models.config import StageModel

COMPARISON_VERSION: Final[str] = ""
BASELINE: Final[str] = ""
ENVIRONMENT: Final = "LLM_AGENT_EVAL_MAIN"


@dataclass(frozen=True)
class SubsetCase:
    id: str
    rationale: str


SUBSET: tuple[SubsetCase, ...] = ()
CANDIDATES: dict[str, StageModel] = {}


def admission_block(name: str) -> str | None:
    raise NotImplementedError


def apply_main(name: str) -> None:
    raise NotImplementedError


def apply_from_environment(env: Mapping[str, str]) -> None:
    raise NotImplementedError


def side_by_side(summaries: Sequence[Mapping[str, Any]]) -> list[str]:
    raise NotImplementedError
