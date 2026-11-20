"""The versioned model rubric: relevance, supported claims and citation support of an answer.

The judge (Claude Sonnet 5.5 at medium effort, pinned separately from the subject) sees only the
case's question, the exact fictional evidence of the case-run and the approved answer. It returns a
structured verdict; the pass decision is computed here in code, never taken from judge prose:

- useful: relevant, in the expected language, at least one claim, and no claim unsupported by the
  evidence (a labelled inference counts as supported);
- citation support: each cited source either supports a claim of the answer or it does not.

A judgement is stored with the hash of its input, the rubric version and the judge settings; the
runner reuses it only when all three match (`compatible`). Judging again is a paid call.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, Protocol

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from evals.datasets.cases import EvalCase

RUBRIC_VERSION = "rubric-v1"
JUDGE_MODEL = "claude-sonnet-5-5"
JUDGE_EFFORT: Final = "medium"
#: Output cap of one judge call, including adaptive thinking.
JUDGE_MAX_TOKENS = 4096
JUDGE_TIMEOUT_SECONDS = 60.0
#: USD per million tokens (checked 2026-11-19); cache writes cost 1.25x input.
JUDGE_PRICE_INPUT = 2.0
JUDGE_PRICE_OUTPUT = 10.0
JUDGE_PRICING_VERSION = "anthropic-2026-11-19"

JUDGE_INSTRUCTIONS = """\
You grade one answer of a portfolio chat assistant for an offline evaluation.
The person in the evidence is fictional. Grade only against the evidence given; do not use outside
knowledge and do not reward fluent text that the evidence does not support.

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
    """The exact input of the judge: question, expected language, evidence and approved answer."""
    result = record.get("result")
    result = result if isinstance(result, dict) else {}
    return {
        "question": case.question,
        "expected_language": case.language,
        "evidence": [
            {"ref": item.get("ref"), "kind": item.get("kind"), "data": item.get("data")}
            for item in result.get("evidence", [])
            if isinstance(item, dict)
        ],
        "answer": {
            "outcome": result.get("outcome"),
            "text": result.get("text"),
            "cited_refs": [
                source.get("ref")
                for source in result.get("sources", [])
                if isinstance(source, dict)
            ],
        },
    }


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
    """Asks the judge once and returns the storable judgement with its measured cost."""
    payload = judge_input(case, record)
    message = await model.ainvoke(
        [
            SystemMessage(JUDGE_INSTRUCTIONS),
            HumanMessage(json.dumps(payload, ensure_ascii=False, indent=2)),
        ]
    )
    cost = _cost(message, reserved_usd)
    try:
        verdict = JudgeVerdict.model_validate_json(_text(message))
    except ValidationError as error:
        raise JudgeFailedError(f"invalid judge verdict ({cost:.6f} USD)") from error
    return Judgement(
        stored={
            "rubric_version": RUBRIC_VERSION,
            "judge_model": JUDGE_MODEL,
            "judge_effort": JUDGE_EFFORT,
            "pricing_version": JUDGE_PRICING_VERSION,
            "input_hash": input_hash(payload),
            "verdict": verdict.model_dump(mode="json"),
            "cost_usd": cost,
        },
        cost_usd=cost,
    )


def reservation_usd(case: EvalCase, record: Mapping[str, Any]) -> float:
    """A conservative upper bound of one judge call: generous input estimate, full output cap."""
    payload = json.dumps(judge_input(case, record), ensure_ascii=False) + JUDGE_INSTRUCTIONS
    input_tokens = len(payload.encode()) // 2 + 500
    return (
        input_tokens * JUDGE_PRICE_INPUT * 1.25 + JUDGE_MAX_TOKENS * JUDGE_PRICE_OUTPUT
    ) / 1_000_000


def _cost(message: BaseMessage, reserved_usd: float) -> float:
    usage = getattr(message, "usage_metadata", None)
    if not usage:
        return reserved_usd
    details = usage.get("input_token_details") or {}
    cache_read = int(details.get("cache_read") or 0)
    cache_write = int(details.get("cache_creation") or 0)
    plain = int(usage.get("input_tokens") or 0) - cache_read - cache_write
    return (
        plain * JUDGE_PRICE_INPUT
        + cache_read * JUDGE_PRICE_INPUT * 0.1
        + cache_write * JUDGE_PRICE_INPUT * 1.25
        + int(usage.get("output_tokens") or 0) * JUDGE_PRICE_OUTPUT
    ) / 1_000_000


def _text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(
        str(block.get("text", ""))
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    )
