"""The admitted generations: claim, generate within the deadline, reconcile once, shut down bounded.

`Generations.submit` admits one operation (or answers busy) and returns at once; the operation
runs as a task this module keeps a strong reference to, never tied to the dispatching request.
Each operation:

1. claims its one-use grant; anything but a successful claim ends it without a model call and
   without a report (the API's own deadline watch settles it);
2. binds itself to the earlier of the request's and the claim's deadline and to the smaller of
   their allowances, so neither the claim nor this service can extend them;
3. stops without a model call when the deadline already passed, or (paid mode) when the daily
   ceiling refuses the allowance;
4. runs the agent, maps its result to the contract and reports it once, with bounded retries
   until a few seconds after the deadline.

`shutdown` closes admission, lets running operations finish within the grace, then cancels the
rest and reports them `cancelled`/`interrupted` with uncertain usage.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import time
from dataclasses import dataclass
from typing import Final

from llm_agent import ChatAgent, ChatRequest, ExecutionLimits, versions

from ai_service.clients.control_api import Claim, ControlApi
from ai_service.runtime.admission import Admission, Slot
from ai_service.runtime.ceiling import DailyCeiling
from ai_service.runtime.mapping import history_for, report_for, stopped_report
from ai_service.schemas import MAX_ALLOWANCE_USD, GenerationRequest, ResultReport

#: How long after its deadline an operation may still try to reconcile its result.
RECONCILE_GRACE_S: Final = 5.0
#: The agent's own deadline cap (`ExecutionLimits.deadline_s`).
_MAX_DEADLINE_S: Final = 60.0
#: How long a claim may take at most.
_CLAIM_TIMEOUT_S: Final = 5.0
#: How long interrupted operations may take to unwind and report after the grace.
_INTERRUPT_BOUND_S: Final = RECONCILE_GRACE_S + 1.0

_log = logging.getLogger("ai_service.generations")


@dataclass
class _Running:
    task: asyncio.Task[None]
    cancel: asyncio.Event


class Generations:
    def __init__(
        self,
        *,
        agent: ChatAgent,
        control: ControlApi,
        admission: Admission,
        ceiling: DailyCeiling | None,
    ) -> None:
        self._agent = agent
        self._control = control
        self._admission = admission
        self._ceiling = ceiling
        self._running: dict[asyncio.Task[None], _Running] = {}

    @property
    def accepting(self) -> bool:
        return not self._admission.closed

    async def submit(self, request: GenerationRequest) -> bool:
        """True once `request` is admitted and running; False (busy) when no slot freed in time."""
        received = time.monotonic()
        slot = await self._admission.admit()
        if slot is None:
            return False
        cancel = asyncio.Event()
        task = asyncio.create_task(self._operate(request, slot, received, cancel))
        self._running[task] = _Running(task, cancel)
        task.add_done_callback(self._forget)
        return True

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
        self, request: GenerationRequest, slot: Slot, received: float, cancel: asyncio.Event
    ) -> None:
        operation = str(request.operation_id)
        try:
            claim = await self._control.claim(
                operation,
                request.grant,
                timeout_s=min(_CLAIM_TIMEOUT_S, max(_seconds_until(request.deadline_at), 0.5)),
            )
            if claim is None:
                _log.info("operation %s: the grant was not claimed", operation)
                return
            deadline_at = min(request.deadline_at, claim.deadline_at)
            until = time.monotonic() + max(_seconds_until(deadline_at), 0.0) + RECONCILE_GRACE_S
            report = await self._generate(request, claim, deadline_at, received, cancel)
            if cancel.is_set():
                until = min(until, time.monotonic() + RECONCILE_GRACE_S)
            if not await self._control.report(operation, report, until=until):
                _log.warning("operation %s: the result was not reconciled", operation)
        except Exception:
            _log.exception("operation %s failed", operation)
        finally:
            slot.release()

    async def _generate(
        self,
        request: GenerationRequest,
        claim: Claim,
        deadline_at: datetime.datetime,
        received: float,
        cancel: asyncio.Event,
    ) -> ResultReport:
        def latency() -> int:
            return round((time.monotonic() - received) * 1000)

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
                    admission_elapsed_s=admission_elapsed,
                    execution_id=str(request.operation_id),
                ),
                limits=ExecutionLimits(
                    deadline_s=min(_MAX_DEADLINE_S, remaining + admission_elapsed),
                    max_cost_usd=allowance,
                ),
                cancel=cancel,
            )
            interrupted = result.outcome == "cancelled" and cancel.is_set()
            if not (interrupted or result.usage.cost_uncertain):
                cost = result.usage.cost_usd
            return report_for(
                result, grant=request.grant, latency_ms=latency(), interrupted=interrupted
            )
        finally:
            if self._ceiling is not None and reservation is not None:
                self._ceiling.settle(reservation, cost)


def _seconds_until(instant: datetime.datetime) -> float:
    return (instant - datetime.datetime.now(datetime.UTC)).total_seconds()
