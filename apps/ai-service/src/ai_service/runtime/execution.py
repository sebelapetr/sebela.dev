"""The admitted operations: claim, run within the deadline, reconcile once, shut down bounded.

An operation is a generation (one answer) or a compaction (one summary of a working context); both
share the slots, the daily ceiling, the Stop and the shutdown. `Generations.submit` admits one
operation (or answers busy) and returns at once; the operation
runs as a task this module keeps a strong reference to, never tied to the dispatching request.
Each operation:

1. claims its one-use grant; anything but a successful claim ends it without a model call and
   without a report (the API's own deadline watch settles it);
2. stops without a model call when the claim's kind, model, effort, pricing version or context
   revision differs from the dispatched request's, or its model, effort (an operation admitted
   without one included) or pricing version from this agent's: it reports `grant_mismatch`
   (`cancelled` for an answer, `failed` for a compaction) with zero, certain usage, which the API
   stores as a failure;
3. binds itself to the earlier of the request's and the claim's deadline and to the smaller of
   their allowances, so neither the claim nor this service can extend them;
4. stops without a model call when the deadline already passed, or (paid mode) when the daily
   ceiling refuses the allowance;
5. runs the agent (`run` or `compact`), maps its result to the contract and reports it once to
   its own result route, with bounded retries until a few seconds after the deadline. With a
   trace export, the claimed grant is bound to the exporter for the agent's one record and
   released when the operation ends (`runtime/telemetry.py`).

`cancel` is the API's Stop of one operation: a running one stops its graph, model and tool work
and reports `cancelled (stopped)` (zero, certain usage when it stopped before a model call; the
agent's measured usage otherwise, uncertain while a model call was in flight); one not yet
dispatched is remembered so its dispatch neither claims nor reports; others run on untouched.

`shutdown` closes admission, lets running operations finish within the grace, then cancels the
rest and reports them `cancelled`/`interrupted` with uncertain usage.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Final

from llm_agent import ChatAgent, ChatRequest, ExecutionLimits, versions
from llm_agent import CompactionRequest as AgentCompaction
from sebela_api_client.models import ChatGrantClaimed

from ai_service.clients.control_api import ControlApi
from ai_service.runtime.admission import Admission, Slot
from ai_service.runtime.ceiling import DailyCeiling
from ai_service.runtime.mapping import (
    compaction_report,
    history_for,
    report_for,
    stopped_compaction,
    stopped_report,
    summary_for,
)
from ai_service.runtime.telemetry import TraceExporter
from ai_service.schemas import (
    MAX_ALLOWANCE_USD,
    CompactionReport,
    CompactionRequest,
    GenerationRequest,
    ResultReport,
)

Request = GenerationRequest | CompactionRequest

#: How long after its deadline an operation may still try to reconcile its result.
RECONCILE_GRACE_S: Final = 5.0
#: The agent's own deadline cap (`ExecutionLimits.deadline_s`).
_MAX_DEADLINE_S: Final = 60.0
#: How long a claim may take at most.
_CLAIM_TIMEOUT_S: Final = 5.0
#: How long interrupted operations may take to unwind and report after the grace.
_INTERRUPT_BOUND_S: Final = RECONCILE_GRACE_S + 1.0
#: How many Stops of operations not (yet) running here are remembered for a late dispatch.
_REMEMBERED_STOPS: Final = 1024

_log = logging.getLogger("ai_service.generations")


@dataclass
class _Running:
    operation: str
    cancel: asyncio.Event
    #: Set by `cancel`: the API stopped this operation, as opposed to a shutdown interrupting it.
    stopped: bool = False


class Generations:
    def __init__(
        self,
        *,
        agent: ChatAgent,
        control: ControlApi,
        admission: Admission,
        ceiling: DailyCeiling | None,
        telemetry: TraceExporter | None = None,
    ) -> None:
        self._agent = agent
        self._telemetry = telemetry
        self._control = control
        self._admission = admission
        self._ceiling = ceiling
        self._running: dict[asyncio.Task[None], _Running] = {}
        self._stopped: OrderedDict[str, None] = OrderedDict()

    @property
    def accepting(self) -> bool:
        return not self._admission.closed

    async def submit(self, request: Request) -> bool:
        """True once `request` is admitted and running; False (busy) when no slot freed in time."""
        received = time.monotonic()
        operation = str(request.operation_id)
        if operation in self._stopped:
            _log.info("operation %s: stopped before its dispatch", operation)
            return True
        slot = await self._admission.admit()
        if slot is None:
            return False
        cancel = asyncio.Event()
        running = _Running(operation, cancel)
        task = asyncio.create_task(self._operate(request, slot, received, running))
        self._running[task] = running
        task.add_done_callback(self._forget)
        if operation in self._stopped:
            running.stopped = True
            cancel.set()
        return True

    def cancel(self, operation_id: str) -> None:
        """Stops `operation_id` here, or remembers the Stop for its dispatch; idempotent."""
        self._stopped[operation_id] = None
        self._stopped.move_to_end(operation_id)
        while len(self._stopped) > _REMEMBERED_STOPS:
            self._stopped.popitem(last=False)
        for running in self._running.values():
            if running.operation == operation_id and not running.cancel.is_set():
                running.stopped = True
                running.cancel.set()

    async def shutdown(self, grace_s: float) -> None:
        """Stops admission, waits up to `grace_s`, then interrupts and reports what still runs."""
        self._admission.close()
        if self._running:
            await asyncio.wait(list(self._running), timeout=grace_s)
        for running in list(self._running.values()):
            running.cancel.set()
        if not self._running:
            return
        _, pending = await asyncio.wait(list(self._running), timeout=_INTERRUPT_BOUND_S)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    def _forget(self, task: asyncio.Task[None]) -> None:
        self._running.pop(task, None)

    async def _operate(
        self, request: Request, slot: Slot, received: float, running: _Running
    ) -> None:
        operation = str(request.operation_id)
        cancel = running.cancel
        try:
            if cancel.is_set():
                return
            claim = await self._control.claim(
                operation,
                request.grant,
                timeout_s=min(_CLAIM_TIMEOUT_S, max(_seconds_until(request.deadline_at), 0.5)),
            )
            if claim is None:
                _log.info("operation %s: the grant was not claimed", operation)
                return
            if self._telemetry is not None:
                self._telemetry.bind(operation, request.grant)
            deadline_at = min(request.deadline_at, claim.deadline_at)
            until = time.monotonic() + max(_seconds_until(deadline_at), 0.0) + RECONCILE_GRACE_S
            report: ResultReport | CompactionReport
            if isinstance(request, CompactionRequest):
                report = await self._compact(request, claim, deadline_at, received, running)
            else:
                report = await self._generate(request, claim, deadline_at, received, running)
            if cancel.is_set():
                until = min(until, time.monotonic() + RECONCILE_GRACE_S)
            if isinstance(report, CompactionReport):
                reported = await self._control.report_compaction(operation, report, until=until)
            else:
                reported = await self._control.report(operation, report, until=until)
            if not reported:
                _log.warning("operation %s: the result was not reconciled", operation)
        except Exception:
            _log.exception("operation %s failed", operation)
        finally:
            if self._telemetry is not None:
                self._telemetry.release(operation)
            slot.release()

    async def _generate(
        self,
        request: GenerationRequest,
        claim: ChatGrantClaimed,
        deadline_at: datetime.datetime,
        received: float,
        running: _Running,
    ) -> ResultReport:
        def latency() -> int:
            return round((time.monotonic() - received) * 1000)

        cancel = running.cancel
        agent = versions()
        if _terms_differ(request, claim, "answer"):
            _log.warning("operation %s: the claimed terms differ", request.operation_id)
            return stopped_report(
                "cancelled",
                "grant_mismatch",
                grant=request.grant,
                latency_ms=latency(),
                versions=agent,
            )
        if cancel.is_set():
            return stopped_report(
                "cancelled",
                "stopped" if running.stopped else "interrupted",
                grant=request.grant,
                latency_ms=latency(),
                versions=agent,
            )
        remaining = _seconds_until(deadline_at)
        if remaining <= 0:
            return stopped_report(
                "limit_reached",
                "deadline",
                grant=request.grant,
                latency_ms=latency(),
                versions=versions(),
            )
        allowance = min(request.allowance_usd, claim.allowance_usd, MAX_ALLOWANCE_USD)
        reservation = None
        if self._ceiling is not None:
            reservation = self._ceiling.reserve(allowance)
            if reservation is None:
                return stopped_report(
                    "unavailable",
                    "daily_ceiling",
                    grant=request.grant,
                    latency_ms=latency(),
                    versions=versions(),
                )
        cost: float | None = None
        try:
            admission_elapsed = time.monotonic() - received
            result = await self._agent.run(
                ChatRequest(
                    question=request.question,
                    today=request.today,
                    history=tuple(history_for(request.history)),
                    summary=summary_for(request.summary),
                    admission_elapsed_s=admission_elapsed,
                    execution_id=str(request.operation_id),
                ),
                limits=ExecutionLimits(
                    deadline_s=min(_MAX_DEADLINE_S, remaining + admission_elapsed),
                    max_cost_usd=allowance,
                ),
                cancel=cancel,
            )
            ended_by_cancel = result.outcome == "cancelled" and cancel.is_set()
            stopped = ended_by_cancel and running.stopped
            interrupted = ended_by_cancel and not running.stopped
            if not (interrupted or result.usage.cost_uncertain):
                cost = result.usage.cost_usd
            return report_for(
                result,
                grant=request.grant,
                latency_ms=latency(),
                interrupted=interrupted,
                stopped=stopped,
            )
        finally:
            if self._ceiling is not None and reservation is not None:
                self._ceiling.settle(reservation, cost)

    async def _compact(
        self,
        request: CompactionRequest,
        claim: ChatGrantClaimed,
        deadline_at: datetime.datetime,
        received: float,
        running: _Running,
    ) -> CompactionReport:
        def latency() -> int:
            return round((time.monotonic() - received) * 1000)

        def stopped(reason: str) -> CompactionReport:
            return stopped_compaction(
                reason,
                grant=request.grant,
                kept=len(request.exchanges),
                latency_ms=latency(),
                versions=versions(),
            )

        cancel = running.cancel
        if _terms_differ(request, claim, "compaction"):
            _log.warning("operation %s: the claimed terms differ", request.operation_id)
            return stopped("grant_mismatch")
        if cancel.is_set():
            return stopped("stopped" if running.stopped else "interrupted")
        remaining = _seconds_until(deadline_at)
        if remaining <= 0:
            return stopped("deadline")
        allowance = min(request.allowance_usd, claim.allowance_usd, MAX_ALLOWANCE_USD)
        reservation = None
        if self._ceiling is not None:
            reservation = self._ceiling.reserve(allowance)
            if reservation is None:
                return stopped("daily_ceiling")
        cost: float | None = None
        try:
            admission_elapsed = time.monotonic() - received
            result = await self._agent.compact(
                AgentCompaction(
                    summary=summary_for(request.summary),
                    exchanges=tuple(history_for(request.exchanges)),
                    admission_elapsed_s=admission_elapsed,
                    execution_id=str(request.operation_id),
                ),
                limits=ExecutionLimits(
                    deadline_s=min(_MAX_DEADLINE_S, remaining + admission_elapsed),
                    max_cost_usd=allowance,
                ),
                cancel=cancel,
            )
            ended_by_cancel = result.outcome == "failed" and cancel.is_set()
            was_stopped = ended_by_cancel and running.stopped
            interrupted = ended_by_cancel and not running.stopped
            if not (interrupted or result.usage.cost_uncertain):
                cost = result.usage.cost_usd
            return compaction_report(
                result,
                grant=request.grant,
                latency_ms=latency(),
                interrupted=interrupted,
                stopped=was_stopped,
            )
        finally:
            if self._ceiling is not None and reservation is not None:
                self._ceiling.settle(reservation, cost)


def _terms_differ(request: Request, claim: ChatGrantClaimed, kind: str) -> bool:
    """Whether the claim binds other terms than the request's or than this agent's."""
    agent = versions()
    return (
        claim.kind.value != kind
        or claim.model != request.model
        or claim.model != agent.main_model
        or claim.effort != request.effort
        or claim.effort != agent.main_effort
        or claim.pricing_version != request.pricing_version
        or claim.pricing_version != agent.pricing
        or claim.context_revision != request.context_revision
    )


def _seconds_until(instant: datetime.datetime) -> float:
    return (instant - datetime.datetime.now(datetime.UTC)).total_seconds()
