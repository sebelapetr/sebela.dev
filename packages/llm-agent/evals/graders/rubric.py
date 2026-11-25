"""The versioned model rubric: relevance, supported claims and citation support of an answer.

The judge (Claude Sonnet 5.5 at medium effort, pinned separately from the subject) sees only the
case's question, the exact fictional evidence of the case-run and the approved answer, with the
trusted contact card the visitor is shown below it, if any. It returns a
structured verdict; the pass decision is computed here in code, never taken from judge prose:

- useful: relevant, in the expected language, at least one claim, and no claim unsupported by the
  evidence (a labelled inference counts as supported);
- citation support: each cited source either supports a claim of the answer or it does not.

A judgement is stored with the hash of its input, the rubric version and the judge settings; the
runner reuses it only when all three match (`compatible`). Judging again is a paid call.

Paid runs judge through the Message Batches API (`batch_params`, run by `evals.judging`); the
direct call (`judge`) is the debugging path. Both send the same instructions and input.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, Protocol

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from evals.datasets.cases import FIXED_TODAY, EvalCase

RUBRIC_VERSION = "rubric-v6"
JUDGE_MODEL = "claude-sonnet-5-5"
JUDGE_EFFORT: Final = "medium"
#: Output cap of one judge call, including adaptive thinking.
JUDGE_MAX_TOKENS = 4096
JUDGE_TIMEOUT_SECONDS = 60.0
#: USD per million tokens (checked 2026-11-19).
JUDGE_PRICE_INPUT = 2.0
JUDGE_PRICE_OUTPUT = 10.0
JUDGE_PRICING_VERSION = "anthropic-2026-11-19"
#: Prompt-caching multipliers of the input price (Anthropic prompt caching pricing): a 5-minute
#: cache write costs 1.25x, a 1-hour write 2x. A cache read is priced at 0.1x, the conservative
#: side of the published read price, so the ledger never under-reports it.
JUDGE_CACHE_WRITE_5M = 1.25
JUDGE_CACHE_WRITE_1H = 2.0
JUDGE_CACHE_READ = 0.1
#: The Message Batches API charges half the price of every token, cached ones included.
JUDGE_BATCH_DISCOUNT = 0.5

JUDGE_INSTRUCTIONS = """\
You grade one answer of a portfolio chat assistant for an offline evaluation.
The person in the evidence is fictional. Grade only against the evidence given; do not use outside
knowledge and do not reward fluent text that the evidence does not support.
answer.contact_card, when it is not null, is the trusted contact card shown to the visitor directly
below the answer text. It counts as evidence: a claim that points the visitor to that card, or
repeats its details, is supported. When it is null, no card is shown.
answer.blocks are cards the website shows below the text (experience, service, exploration or
roadmap cards). Code builds them from cited evidence items, so they are not claims of the answer;
a claim that points the visitor to a card is supported by it. Status values are exact and read as
the assistant's own rules read them: "built" work is delivered work, "tested" work was only tried
and is not built or delivered, and "designed" work is a design that is not implemented.
today is the visitor's calendar day (Europe/Prague); "this week", "last seven days" and similar
windows are relative to it. Learning records (current focus, roadmap progress, diary, statistics,
books, events) show what the person studies or attended, not professional expertise or delivered
work: a claim of professional experience or mastery from them is unsupported, and so is a speaker
role from event attendance, a progress figure the records do not state, or logged time that the
statistics or diary do not give. Durations such as "17h 40m" are the evidence's own values.
conversation, when present, lists the earlier exchanges of the chat, oldest first. It only shows
what the question refers to (such as "that project") and which language the visitor asked for;
it is not evidence, so a claim supported only by an earlier answer is unsupported.

Return:
- relevant: the answer addresses the visitor's question.
- language_correct: the answer is written in the expected language (names may stay as stored).
- claims: every factual claim of the answer about the person, each with support:
  "supported" (stated by the evidence), "labelled_inference" (an inference the answer marks as
  such and the evidence makes reasonable) or "unsupported" (absent from or contradicted by it).
- cited_sources: for every source ref the answer cites, whether that evidence item supports at
  least one claim of the answer.
- note: one short sentence explaining any unsupported claim or irrelevance; empty otherwise.
"""

Support = Literal["supported", "labelled_inference", "unsupported"]


class JudgedClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: str
    support: Support


class JudgedCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ref: str
    supports: bool


class JudgeVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")
    relevant: bool
    language_correct: bool
    claims: list[JudgedClaim] = Field(default_factory=list)
    cited_sources: list[JudgedCitation] = Field(default_factory=list)
    note: str = ""


@dataclass(frozen=True)
class RubricGrade:
    useful: bool
    cited: int
    supported_cited: int
    reasons: tuple[str, ...]


class JudgeModel(Protocol):
    async def ainvoke(self, input: list[BaseMessage]) -> BaseMessage: ...


def judge_input(case: EvalCase, record: Mapping[str, Any]) -> dict[str, Any]:
    """The exact input of the judge: question, expected language, evidence and approved answer.

    A follow-up also carries its earlier exchanges as `conversation`; a first question has none.

    The answer includes the trusted contact card and the structured blocks shown below it (`None`
    and `[]` when none is shown), so a pointer to them is judged against what the visitor sees.
    """
    result = record.get("result")
    result = result if isinstance(result, dict) else {}
    payload: dict[str, Any] = {
        "question": case.question,
        "expected_language": case.language,
        "today": FIXED_TODAY.isoformat(),
        "evidence": [
            {"ref": item.get("ref"), "kind": item.get("kind"), "data": item.get("data")}
            for item in result.get("evidence", [])
            if isinstance(item, dict)
        ],
        "answer": {
            "outcome": result.get("outcome"),
            "text": result.get("text"),
            "contact_card": result.get("contact"),
            "blocks": [block for block in result.get("blocks", []) if isinstance(block, dict)],
            "cited_refs": [
                source.get("ref")
                for source in result.get("sources", [])
                if isinstance(source, dict)
            ],
        },
    }
    if case.history:
        payload["conversation"] = [
            {"question": exchange.question, "answer": exchange.answer} for exchange in case.history
        ]
    return payload


def input_hash(payload: Mapping[str, Any]) -> str:
    settings = {
        "rubric": RUBRIC_VERSION,
        "model": JUDGE_MODEL,
        "effort": JUDGE_EFFORT,
        "instructions": JUDGE_INSTRUCTIONS,
        "input": payload,
    }
    return hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()


def compatible(judgement: Mapping[str, Any], payload: Mapping[str, Any]) -> bool:
    """Whether a stored judgement was made by this rubric and judge on exactly this input."""
    return (
        judgement.get("rubric_version") == RUBRIC_VERSION
        and judgement.get("judge_model") == JUDGE_MODEL
        and judgement.get("judge_effort") == JUDGE_EFFORT
        and judgement.get("input_hash") == input_hash(payload)
        and isinstance(judgement.get("verdict"), dict)
    )


def score(verdict: JudgeVerdict, cited_refs: Sequence[str]) -> RubricGrade:
    """The rubric's pass criteria, applied in code to a structured verdict."""
    reasons: list[str] = []
    if not verdict.relevant:
        reasons.append("judge: not relevant")
    if not verdict.language_correct:
        reasons.append("judge: wrong language")
    if not verdict.claims:
        reasons.append("judge: no factual claim")
    unsupported = [claim.claim for claim in verdict.claims if claim.support == "unsupported"]
    if unsupported:
        reasons.append(f"judge: {len(unsupported)} unsupported claim(s)")
    judged = {citation.ref: citation.supports for citation in verdict.cited_sources}
    cited = list(dict.fromkeys(cited_refs))
    # A cited source the judge did not assess counts as unsupported, never as supported.
    supported = sum(1 for ref in cited if judged.get(ref) is True)
    return RubricGrade(
        useful=not reasons, cited=len(cited), supported_cited=supported, reasons=tuple(reasons)
    )


def judge_response_schema() -> dict[str, Any]:
    """JSON schema for structured outputs (no length/range keywords; closed objects)."""
    claim = {
        "type": "object",
        "properties": {
            "claim": {"type": "string"},
            "support": {
                "type": "string",
                "enum": ["supported", "labelled_inference", "unsupported"],
            },
        },
        "required": ["claim", "support"],
        "additionalProperties": False,
    }
    citation = {
        "type": "object",
        "properties": {"ref": {"type": "string"}, "supports": {"type": "boolean"}},
        "required": ["ref", "supports"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "relevant": {"type": "boolean"},
            "language_correct": {"type": "boolean"},
            "claims": {"type": "array", "items": claim},
            "cited_sources": {"type": "array", "items": citation},
            "note": {"type": "string"},
        },
        "required": ["relevant", "language_correct", "claims", "cited_sources", "note"],
        "additionalProperties": False,
    }


def anthropic_judge() -> JudgeModel:
    """The pinned judge through the shared LangChain Anthropic integration (needs the key)."""
    from langchain_anthropic import ChatAnthropic

    model: JudgeModel = ChatAnthropic(  # type: ignore[call-arg]
        model=JUDGE_MODEL,
        max_tokens=JUDGE_MAX_TOKENS,
        timeout=JUDGE_TIMEOUT_SECONDS,
        max_retries=0,
        thinking={"type": "adaptive"},
        reasoning_effort=JUDGE_EFFORT,
        output_config={"format": {"type": "json_schema", "schema": judge_response_schema()}},
    )
    return model


@dataclass(frozen=True)
class Judgement:
    stored: dict[str, Any]
    cost_usd: float


class JudgeFailedError(Exception):
    """The judge returned no valid verdict; the case-run stays ungraded, never passed."""


async def judge(
    model: JudgeModel, case: EvalCase, record: Mapping[str, Any], *, reserved_usd: float
) -> Judgement:
    """Asks the judge once and returns the storable judgement with its measured cost.

    The fixed instructions and the case block carry a (5-minute) cache breakpoint, so the
    repeats of one case judged in a row read the shared prefix from the cache.
    """
    payload = judge_input(case, record)
    message = await model.ainvoke(
        [
            SystemMessage(content=[_instructions_block(ttl=None)]),
            HumanMessage(content=judge_blocks(payload, ttl=None)),  # type: ignore[arg-type]
        ]
    )
    usage = getattr(message, "usage_metadata", None)
    cost = langchain_usage(usage).usd(batch=False) if usage else reserved_usd
    return judgement_from_text(_text(message), payload, cost)


def judgement_from_text(
    text: str, payload: Mapping[str, Any], cost: float, *, batch_id: str | None = None
) -> Judgement:
    """The storable judgement of a judge reply; `batch_id` names the batch that produced it.

    Raises `JudgeFailedError` (naming the measured cost) when the reply is no valid verdict.
    """
    try:
        verdict = JudgeVerdict.model_validate_json(text)
    except ValidationError as error:
        raise JudgeFailedError(f"invalid judge verdict ({cost:.6f} USD)") from error
    stored: dict[str, Any] = {
        "rubric_version": RUBRIC_VERSION,
        "judge_model": JUDGE_MODEL,
        "judge_effort": JUDGE_EFFORT,
        "pricing_version": JUDGE_PRICING_VERSION,
        "input_hash": input_hash(payload),
        "verdict": verdict.model_dump(mode="json"),
        "cost_usd": cost,
        "batch": batch_id is not None,
    }
    if batch_id is not None:
        stored["batch_id"] = batch_id
    return Judgement(stored=stored, cost_usd=cost)


Ttl = Literal["1h"] | None


def _cache_control(ttl: Ttl) -> dict[str, str]:
    return {"type": "ephemeral"} if ttl is None else {"type": "ephemeral", "ttl": ttl}


def _instructions_block(*, ttl: Ttl) -> dict[str, Any]:
    return {"type": "text", "text": JUDGE_INSTRUCTIONS, "cache_control": _cache_control(ttl)}


def judge_blocks(payload: Mapping[str, Any], *, ttl: Ttl) -> list[dict[str, Any]]:
    """The judge input as two text blocks: the case (cache breakpoint) and then the answer.

    The case block holds everything but the answer, so the repeats of one case share the cached
    prefix; together the blocks carry exactly `payload` (`sent_payload`), and the input hash is
    computed on `payload`, so the split does not change which stored judgements are compatible.
    """
    case_part = {key: value for key, value in payload.items() if key != "answer"}
    return [
        {
            "type": "text",
            "text": json.dumps(case_part, ensure_ascii=False, indent=2),
            "cache_control": _cache_control(ttl),
        },
        {
            "type": "text",
            "text": json.dumps({"answer": payload.get("answer")}, ensure_ascii=False, indent=2),
        },
    ]


def sent_payload(blocks: Sequence[Any]) -> dict[str, Any]:
    """The judge input the blocks carry, merged back into one object."""
    merged: dict[str, Any] = {}
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            merged.update(json.loads(str(block["text"])))
    return merged


def batch_params(case: EvalCase, record: Mapping[str, Any]) -> dict[str, Any]:
    """The Messages API parameters of one batched judge request (1-hour cache breakpoints).

    Same model, effort, output cap, schema, instructions and input as the direct judge.
    """
    return {
        "model": JUDGE_MODEL,
        "max_tokens": JUDGE_MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": {
            "effort": JUDGE_EFFORT,
            "format": {"type": "json_schema", "schema": judge_response_schema()},
        },
        "system": [_instructions_block(ttl="1h")],
        "messages": [
            {"role": "user", "content": judge_blocks(judge_input(case, record), ttl="1h")}
        ],
    }


@dataclass(frozen=True)
class JudgeUsage:
    """The tokens of one judge reply, split by how each is priced."""

    plain: int = 0
    cache_read: int = 0
    cache_write_5m: int = 0
    cache_write_1h: int = 0
    output: int = 0

    def usd(self, *, batch: bool) -> float:
        full = (
            self.plain * JUDGE_PRICE_INPUT
            + self.cache_read * JUDGE_PRICE_INPUT * JUDGE_CACHE_READ
            + self.cache_write_5m * JUDGE_PRICE_INPUT * JUDGE_CACHE_WRITE_5M
            + self.cache_write_1h * JUDGE_PRICE_INPUT * JUDGE_CACHE_WRITE_1H
            + self.output * JUDGE_PRICE_OUTPUT
        ) / 1_000_000
        return full * JUDGE_BATCH_DISCOUNT if batch else full


def langchain_usage(usage: Mapping[str, Any]) -> JudgeUsage:
    """LangChain `usage_metadata`: `input_tokens` includes cache reads and writes.

    When the write is split by TTL, LangChain reports the ephemeral keys and a zero generic
    `cache_creation`; an unsplit write is priced as a 1-hour write (the upper bound).
    """
    details = usage.get("input_token_details") or {}
    read = int(details.get("cache_read") or 0)
    write_5m = int(details.get("ephemeral_5m_input_tokens") or 0)
    write_1h = int(details.get("ephemeral_1h_input_tokens") or 0)
    unsplit = int(details.get("cache_creation") or 0)
    plain = int(usage.get("input_tokens") or 0) - read - write_5m - write_1h - unsplit
    return JudgeUsage(
        plain=max(plain, 0),
        cache_read=read,
        cache_write_5m=write_5m,
        cache_write_1h=write_1h + unsplit,
        output=int(usage.get("output_tokens") or 0),
    )


def api_usage(usage: Mapping[str, Any]) -> JudgeUsage:
    """A raw Messages API usage block: `input_tokens` is the uncached remainder.

    A cache write without the TTL split is priced as a 1-hour write (the upper bound).
    """
    written = int(usage.get("cache_creation_input_tokens") or 0)
    split = usage.get("cache_creation")
    if isinstance(split, Mapping):
        write_5m = int(split.get("ephemeral_5m_input_tokens") or 0)
        write_1h = int(split.get("ephemeral_1h_input_tokens") or 0)
        write_1h += max(written - write_5m - write_1h, 0)
    else:
        write_5m, write_1h = 0, written
    return JudgeUsage(
        plain=int(usage.get("input_tokens") or 0),
        cache_read=int(usage.get("cache_read_input_tokens") or 0),
        cache_write_5m=write_5m,
        cache_write_1h=write_1h,
        output=int(usage.get("output_tokens") or 0),
    )


def reservation_usd(case: EvalCase, record: Mapping[str, Any], *, batch: bool = False) -> float:
    """A conservative upper bound of one judge call: generous input estimate, all of it priced as a
    1-hour cache write, and the full output cap. A batched request is billed at the batch discount
    on every token, cache writes included, so its bound is discounted too; a direct call's is not.
    """
    payload = json.dumps(judge_input(case, record), ensure_ascii=False) + JUDGE_INSTRUCTIONS
    input_tokens = len(payload.encode()) // 2 + 500
    input_usd = input_tokens * JUDGE_PRICE_INPUT * JUDGE_CACHE_WRITE_1H
    full = (input_usd + JUDGE_MAX_TOKENS * JUDGE_PRICE_OUTPUT) / 1_000_000
    return full * JUDGE_BATCH_DISCOUNT if batch else full


def _text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(
        str(block.get("text", ""))
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    )
