"""The LangGraph flow of one turn: security, then main unless the verdict blocks, then output.

A verdict blocks when it is `BLOCK`, or `UNCERTAIN` in the `abuse` category (`Verdict.blocks`).

Every path ends in the Output Guard. A stage that stops the execution records the stop in the state
and the flow goes straight to the guard, which turns it into a fixed response.
"""

from __future__ import annotations

from functools import cache
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from llm_agent.pipelines.chat.stages.main_agent import answer
from llm_agent.pipelines.chat.stages.output_guard import finalize
from llm_agent.pipelines.chat.stages.security_gateway import classify
from llm_agent.pipelines.chat.state import ChatState, Execution
from llm_agent.reliability.stops import ExecutionStopped


def _execution(config: RunnableConfig) -> Execution:
    execution = config.get("configurable", {}).get("execution")
    if not isinstance(execution, Execution):
        raise TypeError("the run configuration carries no execution")
    return execution


async def _security(state: ChatState, config: RunnableConfig) -> dict[str, Any]:
    try:
        return {"verdict": await classify(_execution(config))}
    except ExecutionStopped as stop:
        return {"stopped": stop}


async def _main(state: ChatState, config: RunnableConfig) -> dict[str, Any]:
    verdict = state["verdict"]
    try:
        draft = await answer(_execution(config), uncertain=verdict.verdict == "UNCERTAIN")
    except ExecutionStopped as stop:
        return {"stopped": stop}
    return {"draft": draft} if draft is not None else {"declined": True}


async def _output(state: ChatState, config: RunnableConfig) -> dict[str, Any]:
    return {"result": await finalize(_execution(config), state)}


def _after_security(state: ChatState) -> Literal["main", "output"]:
    verdict = state.get("verdict")
    if state.get("stopped") is None and verdict is not None and not verdict.blocks:
        return "main"
    return "output"


@cache
def chat_graph() -> Any:
    """The compiled graph; it holds no per-execution state and is shared by all executions."""
    graph = StateGraph(ChatState)
    graph.add_node("security", _security)
    graph.add_node("main", _main)
    graph.add_node("output", _output)
    graph.add_edge(START, "security")
    graph.add_conditional_edges("security", _after_security, ["main", "output"])
    graph.add_edge("main", "output")
    graph.add_edge("output", END)
    return graph.compile()
