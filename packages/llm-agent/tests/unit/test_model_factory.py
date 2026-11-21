"""The production model factory: what a `ModelCall` asks the provider for. No request is sent."""

from __future__ import annotations

from typing import Any

import pytest

from llm_agent import ModelCall, anthropic_model_factory
from llm_agent.pipelines.chat.stages.main_agent import DRAFT_SCHEMA
from llm_agent.tools.registry import TOOL_SPECS


def _call(**overrides: Any) -> ModelCall:
    settings: dict[str, Any] = {
        "stage": "main",
        "model": "claude-haiku-5-5",
        "effort": "medium",
        "max_tokens": 100,
        "timeout_s": 1.0,
        "tools": TOOL_SPECS,
        "response_schema": DRAFT_SCHEMA,
    }
    return ModelCall(**{**settings, **overrides})


@pytest.fixture(autouse=True)
def _offline_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-used")


def test_a_tool_decision_leaves_the_tool_choice_to_the_model() -> None:
    bound: Any = anthropic_model_factory()(_call())
    assert len(bound.kwargs["tools"]) == len(TOOL_SPECS)
    assert "tool_choice" not in bound.kwargs


def test_an_answer_only_decision_keeps_the_tools_defined_but_forbids_their_use() -> None:
    """The history's tool calls need their definitions; `none` makes the model answer instead."""
    bound: Any = anthropic_model_factory()(_call(answer_only=True))
    assert len(bound.kwargs["tools"]) == len(TOOL_SPECS)
    assert bound.kwargs["tool_choice"] == {"type": "none"}


def test_answer_only_needs_tools() -> None:
    with pytest.raises(ValueError, match="answer_only"):
        _call(tools=(), answer_only=True)
