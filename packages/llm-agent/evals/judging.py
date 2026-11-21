"""Buys rubric judgements for a set of case-runs: one Message Batches API batch, or direct calls.

The caller hands over the judge requests of one chunk of a paid run and gets one `JudgeOutcome`
per request, keyed by its `custom_id` (stable per case-run: `<case>-r<repeat>`). This module
hides the batch lifecycle (create, bounded polling, cancel on timeout, results matched by
`custom_id`, never by position) and the charging rules:

- the whole set is reserved before anything is sent (`BudgetBlockedError` otherwise), each
  request at the upper bound of its mode (`rubric.reservation_usd`);
- a succeeded batch result is charged its measured cost at the batch discount
  (`rubric.JUDGE_BATCH_DISCOUNT`), a direct call its full measured cost;
- an errored, cancelled, expired or missing result, a batch that did not end within
  `BATCH_MAX_WAIT_SECONDS` and a batch that could not be created are charged each request's whole
  reservation as uncertain, and the request gets a visible failure, never a pass.

Batch and direct requests send the same judge model, effort, instructions and input
(`rubric.batch_params`, `rubric.judge`), so their stored judgements are comparable; the stored
judgement records `batch` and, for a batch, its `batch_id`. The subject is never batched.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from evals import budget
from evals.datasets.cases import EvalCase
from evals.graders import rubric

#: The longest a paid run waits for its judge batch before it cancels it (most end far sooner).
BATCH_MAX_WAIT_SECONDS = 3600.0
#: Pause between two status checks of a batch.
POLL_SECONDS = 30.0
#: Timeout of one batch API call (create, retrieve, results, cancel).
BATCH_CALL_TIMEOUT_SECONDS = 60.0

_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")


class MessageBatches(Protocol):
    """The four calls of `AsyncAnthropic().messages.batches` the judge uses."""

    async def create(self, *, requests: list[dict[str, Any]]) -> Any: ...

    async def retrieve(self, message_batch_id: str) -> Any: ...

    async def results(self, message_batch_id: str) -> Any: ...

    async def cancel(self, message_batch_id: str) -> Any: ...


@dataclass(frozen=True)
class JudgeRequest:
    custom_id: str
    case: EvalCase
    record: Mapping[str, Any]
    reserved_usd: float


@dataclass(frozen=True)
class JudgeOutcome:
    """A judgement, or the visible reason there is none (the case-run stays ungraded)."""

    judgement: rubric.Judgement | None
    failure: str | None = None


def custom_id(case_id: str, repeat: int) -> str:
    """The batch request id of one case-run: `[A-Za-z0-9_-]`, at most 64 characters."""
    suffix = f"-r{repeat}"
    return _UNSAFE.sub("_", case_id)[: 64 - len(suffix)] + suffix


def request(case: EvalCase, record: Mapping[str, Any], *, batch: bool = True) -> JudgeRequest:
    """One case-run's judge request, reserved at the price of its mode (`batch=False` for
    `judge_directly`)."""
    return JudgeRequest(
        custom_id=custom_id(case.id, int(record["repeat"])),
        case=case,
        record=record,
        reserved_usd=rubric.reservation_usd(case, record, batch=batch),
    )


def anthropic_batches() -> MessageBatches:
    """The Message Batches API client (needs the key). No retries: a retried create could buy the
    same judgements twice."""
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(max_retries=0, timeout=BATCH_CALL_TIMEOUT_SECONDS)
    batches: MessageBatches = client.messages.batches  # type: ignore[assignment]
    return batches


async def judge_in_batch(
    requests: Sequence[JudgeRequest],
    allowance: budget.Allowance,
    *,
    batches: MessageBatches | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
    max_wait_seconds: float = BATCH_MAX_WAIT_SECONDS,
) -> dict[str, JudgeOutcome]:
    """Judges every request in one batch and charges each result (see the module docstring)."""
    if not requests:
        return {}
    _reserve(requests, allowance)
    client = batches if batches is not None else anthropic_batches()
    sent = [
        {"custom_id": item.custom_id, "params": rubric.batch_params(item.case, item.record)}
        for item in requests
    ]
    try:
        created = _as_dict(await client.create(requests=sent))
    except Exception as error:  # nothing measured: every reservation is consumed
        return _uncertain(requests, allowance, f"judge batch failed: {type(error).__name__}")
    batch_id = str(created.get("id"))
    started = clock()
    status = str(created.get("processing_status"))
    try:
        while status != "ended":
            if clock() - started >= max_wait_seconds:
                with contextlib.suppress(Exception):
                    await client.cancel(batch_id)
                return _uncertain(
                    requests,
                    allowance,
                    f"judge batch: {batch_id} did not end within {max_wait_seconds:.0f} s",
                )
            await sleep(POLL_SECONDS)
            status = str(_as_dict(await client.retrieve(batch_id)).get("processing_status"))
        results: dict[str, dict[str, Any]] = {}
        async for item in await client.results(batch_id):
            entry = _as_dict(item)
            results[str(entry.get("custom_id"))] = _as_dict(entry.get("result"))
    except Exception as error:
        with contextlib.suppress(Exception):
            await client.cancel(batch_id)
        return _uncertain(
            requests, allowance, f"judge batch: {batch_id} failed: {type(error).__name__}"
        )
    return {
        item.custom_id: _batch_outcome(item, results.get(item.custom_id), batch_id, allowance)
        for item in requests
    }


async def judge_directly(
    requests: Sequence[JudgeRequest],
    allowance: budget.Allowance,
    *,
    model: rubric.JudgeModel,
) -> dict[str, JudgeOutcome]:
    """The debugging path: one direct judge call per request, in order, at the full price."""
    _reserve(requests, allowance)
    outcomes: dict[str, JudgeOutcome] = {}
    for item in requests:
        purpose = _purpose(item)
        try:
            judgement = await rubric.judge(
                model, item.case, item.record, reserved_usd=item.reserved_usd
            )
        except rubric.JudgeFailedError as error:
            allowance.charge(item.reserved_usd, purpose, uncertain=True)
            outcomes[item.custom_id] = JudgeOutcome(None, str(error))
        except Exception as error:  # a failed paid call still consumes its reservation
            allowance.charge(item.reserved_usd, purpose, uncertain=True)
            outcomes[item.custom_id] = JudgeOutcome(
                None, f"judge call failed: {type(error).__name__}"
            )
        else:
            allowance.charge(judgement.cost_usd, purpose)
            outcomes[item.custom_id] = JudgeOutcome(judgement)
    return outcomes


def _reserve(requests: Sequence[JudgeRequest], allowance: budget.Allowance) -> None:
    total = sum(item.reserved_usd for item in requests)
    allowance.require(total, f"judging {len(requests)} case-run(s)")


def _purpose(item: JudgeRequest) -> str:
    return f"judge {item.case.id}#{item.record['repeat']}"


def _uncertain(
    requests: Sequence[JudgeRequest], allowance: budget.Allowance, failure: str
) -> dict[str, JudgeOutcome]:
    for item in requests:
        allowance.charge(item.reserved_usd, _purpose(item), uncertain=True)
    return {item.custom_id: JudgeOutcome(None, failure) for item in requests}


def _batch_outcome(
    item: JudgeRequest,
    result: Mapping[str, Any] | None,
    batch_id: str,
    allowance: budget.Allowance,
) -> JudgeOutcome:
    kind = "missing" if result is None else str(result.get("type"))
    message = _as_dict(result.get("message")) if result is not None else {}
    if kind != "succeeded" or not message:
        # Only succeeded requests are billed by the API; an unclear result still consumes its
        # reservation, so the ledger never under-reports.
        allowance.charge(item.reserved_usd, _purpose(item), uncertain=True)
        return JudgeOutcome(None, f"judge batch: {kind} ({batch_id})")
    usage = _as_dict(message.get("usage"))
    if not usage:
        allowance.charge(item.reserved_usd, _purpose(item), uncertain=True)
        cost = item.reserved_usd
    else:
        cost = rubric.api_usage(usage).usd(batch=True)
        allowance.charge(cost, _purpose(item))
    text = "".join(
        str(block.get("text", ""))
        for block in (_as_dict(part) for part in message.get("content") or [])
        if block.get("type") == "text"
    )
    payload = rubric.judge_input(item.case, item.record)
    try:
        judgement = rubric.judgement_from_text(text, payload, cost, batch_id=batch_id)
    except rubric.JudgeFailedError as error:
        return JudgeOutcome(None, str(error))
    return JudgeOutcome(judgement)


def _as_dict(value: Any) -> dict[str, Any]:
    """SDK models and plain mappings alike (the fakes return dicts)."""
    if isinstance(value, Mapping):
        return dict(value)
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        dumped = dump(mode="json")
        if isinstance(dumped, dict):
            return dumped
    return {}
