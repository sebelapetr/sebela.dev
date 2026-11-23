"""The public chat operations: one guarded, bounded, bilingual answer to one visitor question,
and the compaction of a conversation's working context.

`ChatAgent.run` always returns a `ChatResult` and never raises for a model, content, limit or
cancellation failure: each becomes a fixed response with a stable reason. `ChatAgent.compact`
likewise always returns a `CompactionResult`; on any failure it keeps the prior working context.
Each run and compaction owns its budget, deadline, evidence and trace; nothing is shared between
concurrent executions except the compiled graph.
The deadline starts at admission: time the caller already spent admitting the turn is deducted.
A final result is exported to the optional telemetry sink, whose failures change nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Final

from langsmith.run_helpers import tracing_context

from llm_agent.context.compact import split, summarize, summary_tokens
from llm_agent.context.history import history_block, select_context
from llm_agent.context.tokens import text_tokens
from llm_agent.guardrails.input import select_language
from llm_agent.models.gateway import Gateway, ModelFactory, ModelUnavailable
from llm_agent.observability.telemetry import TelemetrySink, export
from llm_agent.observability.tracing import Tracer
from llm_agent.pipelines.chat.graph import chat_graph
from llm_agent.pipelines.chat.stages.output_guard import stopped_result, with_trace
from llm_agent.pipelines.chat.state import Execution
from llm_agent.pipelines.chat.versions import versions
from llm_agent.reliability.budgets import Budget
from llm_agent.reliability.stops import Cancelled, ExecutionStopped, LimitReached, Unavailable
from llm_agent.reliability.timeouts import Deadline
from llm_agent.schemas import (
    ChatExchange,
    ChatRequest,
    ChatResult,
    CompactionOutcome,
    CompactionRequest,
    CompactionResult,
    ContextSummary,
    ExecutionLimits,
)
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

    async def compact(
        self,
        request: CompactionRequest,
        *,
        limits: ExecutionLimits | None = None,
        cancel: asyncio.Event | None = None,
    ) -> CompactionResult:
        """Folds the prior summary and all but the newest exchanges into one validated summary.

        Only the current working context is folded: the summary and the newest exchanges the
        chat history envelope (`history_exchanges`, `history_tokens`) selects for the next
        answer; exchanges it already excludes, and a summary hidden behind them, stay out.
        A context of no more than the kept exchanges is `unchanged` without a model call or cost.
        Otherwise one logical Main-model call with no tools runs within `limits` (the chat
        defaults: deadline, Main input/output caps, the one shared retry and the cost allowance).
        A provider, validation, limit, deadline or cancellation failure is `failed` and keeps the
        prior summary and every exchange; nothing is replayed. The caller installs the summary
        only on `compacted`, together with the `kept` newest exchanges.
        """
        limits = limits or ExecutionLimits()
        tracer = Tracer()
        budget = Budget(limits)
        exchanges = request.exchanges
        selected_summary, selected = select_context(
            exchanges,
            request.summary,
            max_exchanges=limits.history_exchanges,
            max_tokens=limits.history_tokens,
        )
        folded, kept = split(selected)

        def next_input(summary: ContextSummary | None, remaining: tuple[ChatExchange, ...]) -> int:
            shown_summary, shown = select_context(
                remaining,
                summary,
                max_exchanges=limits.history_exchanges,
                max_tokens=limits.history_tokens,
            )
            return text_tokens(history_block(shown, summary=shown_summary))

        def result(
            outcome: CompactionOutcome,
            reason: str | None,
            summary: ContextSummary | None,
            kept: int,
        ) -> CompactionResult:
            remaining: tuple[ChatExchange, ...] = exchanges[len(exchanges) - kept :]
            return CompactionResult(
                outcome=outcome,
                reason=reason,
                summary=summary,
                kept=kept,
                summary_tokens=summary_tokens(summary),
                next_input_tokens=next_input(summary, remaining),
                usage=budget.usage(),
                trace=list(tracer.spans),
                versions=versions(),
                execution_id=request.execution_id,
                trace_id=request.trace_id,
            )

        if not folded:
            return result("unchanged", "nothing_to_compact", request.summary, len(exchanges))
        started = tracer.start()
        installed = await self._summary(
            request, selected_summary, folded, limits, budget, tracer, cancel
        )
        labels: dict[str, int] = {"folded_exchanges": len(folded), "kept_exchanges": kept}
        if isinstance(installed, str):
            tracer.finish("compaction", installed, started, **labels)
            return result("failed", installed, request.summary, len(exchanges))
        tracer.finish("compaction", "ok", started, **labels)
        return result("compacted", None, installed, kept)

    async def _summary(
        self,
        request: CompactionRequest,
        summary: ContextSummary | None,
        folded: tuple[ChatExchange, ...],
        limits: ExecutionLimits,
        budget: Budget,
        tracer: Tracer,
        cancel: asyncio.Event | None,
    ) -> ContextSummary | str:
        """The validated summary, or the reason none can be installed."""
        if cancel is not None and cancel.is_set():
            return "cancelled"
        deadline = Deadline(limits.deadline_s - request.admission_elapsed_s)
        if deadline.expired:
            return "deadline"
        gateway = Gateway(self._models, budget, deadline, tracer)
        # Visitor text never leaves through LangChain's tracing (as for `run`).
        with tracing_context(enabled=False):
            task = asyncio.ensure_future(
                summarize(
                    gateway,
                    limits,
                    summary=summary,
                    folded=folded,
                    language=request.exchanges[-1].language,
                )
            )
        stopped = await _stopped_first(task, cancel, deadline.remaining() + DEADLINE_GRACE_S)
        if stopped is not None:
            budget.abandon()
            return stopped
        try:
            return task.result()
        except ModelUnavailable:
            return "model_unavailable"
        except ExecutionStopped as stop:
            return stop.reason
        except Exception:
            budget.abandon()
            return "internal_error"

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
        try:
            return await _outcome(execution, task, cancel)
        finally:
            await execution.tools.close()

    def _execution(self, request: ChatRequest, limits: ExecutionLimits) -> Execution:
        tracer = Tracer()
        budget = Budget(limits)
        deadline = Deadline(limits.deadline_s - request.admission_elapsed_s)
        return Execution(
            request=request,
            limits=limits,
            language=select_language(
                request.question,
                request.history,
                request.summary.language if request.summary else None,
            ),
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


async def _outcome(
    execution: Execution,
    task: asyncio.Future[Any],
    cancel: asyncio.Event | None,
) -> ChatResult:
    """The graph's result, or the stopped result when `cancel` or the deadline comes first."""
    stopped = await _stopped_first(task, cancel, execution.deadline.remaining() + DEADLINE_GRACE_S)
    if stopped is not None:
        execution.budget.abandon()
        stop: ExecutionStopped = Cancelled() if stopped == "cancelled" else LimitReached("deadline")
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


async def _stopped_first(
    task: asyncio.Future[Any], cancel: asyncio.Event | None, wait_s: float
) -> str | None:
    """None when `task` finished first; otherwise it is cancelled and the reason returned."""
    waiters: set[asyncio.Future[Any]] = {task}
    cancelled: asyncio.Future[Any] | None = None
    if cancel is not None:
        cancelled = asyncio.ensure_future(cancel.wait())
        waiters.add(cancelled)
    try:
        done, _ = await asyncio.wait(waiters, timeout=wait_s, return_when=asyncio.FIRST_COMPLETED)
    finally:
        if cancelled is not None:
            cancelled.cancel()
    if task in done:
        return None
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError, Exception):
        await task
    return "cancelled" if done else "deadline"


def _stopped(execution: Execution, stop: ExecutionStopped) -> ChatResult:
    return with_trace(execution, stopped_result(execution, stop))


__all__ = ["ChatAgent", "versions"]
