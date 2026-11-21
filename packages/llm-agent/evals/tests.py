"""The Promptfoo test list: the selected implemented cases.

The runner names them in `LLM_AGENT_EVAL_CASES`.

Every test carries only the case id and its question; the provider looks the case up itself and
the code assertion (`graders/assertion.py`) applies the case's deterministic checks.
"""

from __future__ import annotations

import os
from typing import Any

from evals.datasets.cases import BY_ID


def generate_tests(config: object = None) -> list[dict[str, Any]]:
    selected = [
        case_id for case_id in os.environ.get("LLM_AGENT_EVAL_CASES", "").split(",") if case_id
    ]
    tests: list[dict[str, Any]] = []
    for case_id in selected:
        case = BY_ID[case_id]
        tests.append(
            {
                "description": case.id,
                "vars": {"case_id": case.id, "question": case.question},
                "assert": [{"type": "python", "value": "file://graders/assertion.py"}],
            }
        )
    return tests
