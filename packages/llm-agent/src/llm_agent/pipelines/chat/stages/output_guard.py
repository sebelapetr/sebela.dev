"""Output Guard: the only producer of a `ChatResult`. No model is called here.

A stopped execution, a block and a declined request get fixed EN/CS responses. A draft is reviewed
deterministically: it passes, is repaired by dropping sources that are not this turn's evidence, or
is replaced as a whole by the fixed insufficient-evidence response. Whenever the visitor should ask
directly, the contact card is built from a trusted `get_contact` read, never from model text; if
that read fails the result is `unavailable`, so a draft is never shown without its required card.
The card is required for every honest unknown: an `insufficient_evidence` outcome, a replaced draft
and a draft whose `unpublished` flag says its text states that an asked fact is not published, even
when the model chose `answered`; the card never depends on the outcome choice alone.
An answered draft carries the typed blocks of the experiences, services and explorations it cites,
built from their evidence records; no other result carries blocks.
"""

from __future__ import annotations

from llm_agent.guardrails.output import Draft, review
from llm_agent.guardrails.policies import MANIPULATION_CATEGORIES, FixedText, text
from llm_agent.pipelines.chat.state import ChatState, Execution
from llm_agent.pipelines.chat.versions import versions
from llm_agent.prompts import system_prompt_texts
from llm_agent.reliability.stops import ExecutionStopped
from llm_agent.schemas import ChatResult, ContactCard, Language, Outcome, Source


async def finalize(execution: Execution, state: ChatState) -> ChatResult:
    tracer = execution.tracer
    started = tracer.start()
    stopped = state.get("stopped")
    verdict = state.get("verdict")
    draft = state.get("draft")
    action = "fixed"
    unpublished: bool | None = None
    if stopped is not None:
        result = stopped_result(execution, stopped)
    elif verdict is not None and verdict.verdict == "BLOCK":
        kind: FixedText = (
            "manipulation" if verdict.category in MANIPULATION_CATEGORIES else "out_of_scope"
        )
        result = _fixed(execution, "refused", f"blocked_{verdict.category}", kind)
    elif draft is None:
        result = _fixed(execution, "refused", "declined", "out_of_scope")
    else:
        result, action = await _reviewed(execution, draft)
        unpublished = draft.unpublished
    tracer.finish(
        "stage.output",
        "ok",
        started,
        action=action,
        outcome=result.outcome,
        unpublished=unpublished,
    )
    return with_trace(execution, result)


def stopped_result(execution: Execution, stopped: ExecutionStopped) -> ChatResult:
    return _fixed(execution, stopped.outcome, stopped.reason, stopped.outcome)


async def _reviewed(execution: Execution, draft: Draft) -> tuple[ChatResult, str]:
    tools = execution.tools
    verdict = review(
        draft,
        tools.by_ref(),
        contact=tools.contact_card(),
        prompt_texts=system_prompt_texts(),
    )
    if verdict.action == "replace":
        outcome: Outcome = "insufficient_evidence"
        reason: str | None = "output_replaced"
        language: Language = execution.language
        body = text("insufficient", language)
        refs: tuple[str, ...] = ()
        needs_contact = True
    else:
        outcome = draft.outcome
        reason = None if outcome == "answered" else "insufficient_evidence"
        language = draft.language
        body = draft.text
        refs = verdict.refs
        # An honest unknown carries the card whichever outcome the model chose for it.
        needs_contact = (
            outcome == "insufficient_evidence" or draft.show_contact or draft.unpublished
        )
    contact: ContactCard | None = None
    if needs_contact:
        contact = tools.contact_card()
        if contact is None and await tools.ensure("get_contact"):
            contact = tools.contact_card()
        if contact is None:
            unavailable = _fixed(execution, "unavailable", "content_unavailable", "unavailable")
            return unavailable, verdict.action
    evidence = tools.by_ref()
    sources = [
        Source(
            ref=ref,
            kind=evidence[ref].kind,
            record_id=evidence[ref].record_id,
            title=evidence[ref].title,
            href=evidence[ref].href,
        )
        for ref in refs
    ]
    result = ChatResult(
        outcome=outcome,
        reason=reason,
        language=language,
        text=body,
        contact=contact,
        sources=sources,
        blocks=tools.blocks(refs) if outcome == "answered" else [],
        evidence=list(tools.evidence),
        usage=execution.budget.usage(),
        trace=[],
        versions=versions(),
    )
    return result, verdict.action


def _fixed(execution: Execution, outcome: Outcome, reason: str, kind: FixedText) -> ChatResult:
    return ChatResult(
        outcome=outcome,
        reason=reason,
        language=execution.language,
        text=text(kind, execution.language),
        contact=None,
        sources=[],
        evidence=[],
        usage=execution.budget.usage(),
        trace=[],
        versions=versions(),
    )


def with_trace(execution: Execution, result: ChatResult) -> ChatResult:
    return result.model_copy(
        update={
            "usage": execution.budget.usage(),
            "trace": list(execution.tracer.spans),
            "execution_id": execution.request.execution_id,
            "trace_id": execution.request.trace_id,
        }
    )
