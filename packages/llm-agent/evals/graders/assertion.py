"""Promptfoo's code assertion: the deterministic graders of `code.py` on one provider record.

Promptfoo's own pass/fail is informational; the runner (`evals/run.py`) grades the stored records
again with the same graders plus the rubric and applies the gates.
"""

from __future__ import annotations

import json
from typing import Any

from evals.catalogue import BY_ID as CATALOGUE
from evals.datasets.cases import BY_ID
from evals.graders.code import grade_code


def get_assert(output: str, context: dict[str, Any]) -> dict[str, Any]:
    case_id = str(context.get("vars", {}).get("case_id", ""))
    case = BY_ID.get(case_id)
    if case is None:
        return {"pass": False, "score": 0, "reason": f"unknown case {case_id!r}"}
    try:
        record = json.loads(output)
    except (TypeError, ValueError):
        return {"pass": False, "score": 0, "reason": "the provider returned no record"}
    grade = grade_code(case, record, critical=CATALOGUE[case_id].critical)
    return {
        "pass": grade.passed,
        "score": 1 if grade.passed else 0,
        "reason": "; ".join(grade.failures) or "deterministic checks passed",
    }
