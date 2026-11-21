"""The public chat operation: one guarded, bounded, bilingual answer to one visitor question.

`ChatAgent.run` always returns a `ChatResult` and never raises for a model, content, limit or
cancellation failure: each becomes a fixed response with a stable reason. Each run owns its budget,
deadline, evidence and trace; nothing is shared between concurrent runs except the compiled graph.
The deadline starts at admission: time the caller already spent admitting the turn is deducted.
A final result is exported to the optional telemetry sink, whose failures change nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Final

from langsmith.run_helpers import tracing_context

from llm_agent.context.tokens import text_tokens
from llm_agent.guardrails.input import select_language
from llm_agent.models.gateway import Gateway, ModelFactory
from llm_agent.observability.telemetry import TelemetrySink, export
from llm_agent.observability.tracing import Tracer
from llm_agent.pipelines.chat.graph import chat_graph
from llm_agent.pipelines.chat.stages.output_guard import stopped_result, with_trace
from llm_agent.pipelines.chat.state import Execution
from llm_agent.pipelines.chat.versions import versions
from llm_agent.reliability.budgets import Budget
from llm_agent.reliability.stops import Cancelled, ExecutionStopped, LimitReached, Unavailable
from llm_agent.reliability.timeouts import Deadline
from llm_agent.schemas import ChatRequest, ChatResult, ExecutionLimits
from llm_agent.tools.content import ContentReader
from llm_agent.tools.registry import Tools

#: Time the graph may take past the deadline to unwind before the run is stopped from outside.
DEADLINE_GRACE_S: Final = 0.5


class ChatAgent:
    """Answers one visitor question at a time over public content reads."""

    def __init__(
        self,
        *,
        content: ContentReader,
        models: ModelFactory,
        telemetry: TelemetrySink | None = None,
    ) -> None:
        self._content = content
        self._models = models
        self._telemetry = telemetry

    async def run(
        self,
        request: ChatRequest,
        *,
        limits: ExecutionLimits | None = None,
        cancel: asyncio.Event | None = None,
    ) -> ChatResult:
        """Answers `request` within `limits` (the defaults when omitted).

        `limits` is trusted as given and not revalidated: callers pass an `ExecutionLimits` the
        request schema produced. Only the evals' Main-model comparison constructs a
        `ComparisonLimits` above the public cost cap; services must not rely on this method to
        refuse one.
        """
        result = await self._run(request, limits or ExecutionLimits(), cancel)
        export(self._telemetry, result)
        return result

    async def _run(
        self, request: ChatRequest, limits: ExecutionLimits, cancel: asyncio.Event | None
    ) -> ChatResult:
        execution = self._execution(request, limits)
        if text_tokens(request.question) > limits.question_tokens:
            return _stopped(execution, LimitReached("question_too_long"))
        if cancel is not None and cancel.is_set():
            return _stopped(execution, Cancelled())
        if execution.deadline.expired:
            return _stopped(execution, LimitReached("deadline"))
        # Visitor text never leaves through LangChain's tracing: the task copies this context,
        # so LangSmith stays off whatever LANGSMITH_TRACING says.
        with tracing_context(enabled=False):
            task = asyncio.ensure_future(
                chat_graph().ainvoke({}, config={"configurable": {"execution": execution}})
            )
        waiters: set[asyncio.Future[Any]] = {task}
        cancelled: asyncio.Future[Any] | None = None
        if cancel is not None:
            cancelled = asyncio.ensure_future(cancel.wait())
            waiters.add(cancelled)
        try:
            done, _ = await asyncio.wait(
                waiters,
                timeout=execution.deadline.remaining() + DEADLINE_GRACE_S,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            if cancelled is not None:
                cancelled.cancel()
        if task not in done:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
            execution.budget.abandon()
            stop: ExecutionStopped = Cancelled() if done else LimitReached("deadline")
            return _stopped(execution, stop)
        try:
            state = task.result()
        except Exception:
            execution.budget.abandon()
            return _stopped(execution, Unavailable("internal_error"))
        result = state.get("result")
        if not isinstance(result, ChatResult):
            return _stopped(execution, Unavailable("internal_error"))
        return result

    def _execution(self, request: ChatRequest, limits: ExecutionLimits) -> Execution:
        tracer = Tracer()
        budget = Budget(limits)
        deadline = Deadline(limits.deadline_s - request.admission_elapsed_s)
        return Execution(
            request=request,
            limits=limits,
            language=select_language(request.question, request.history),
            budget=budget,
            deadline=deadline,
            gateway=Gateway(self._models, budget, deadline, tracer),
            tools=Tools(
                self._content,
                tracer=tracer,
                deadline=deadline,
                call_s=limits.tool_call_s,
                result_tokens=limits.tool_result_tokens,
            ),
            tracer=tracer,
        )


def _stopped(execution: Execution, stop: ExecutionStopped) -> ChatResult:
    return with_trace(execution, stopped_result(execution, stop))


__all__ = ["ChatAgent", "versions"]
