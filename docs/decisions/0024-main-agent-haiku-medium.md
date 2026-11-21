# 0024 — The Main Agent runs Claude Haiku 5.5 at medium effort

Status: accepted
Date: 2026-11-21

## Decision

- The Main Agent of `packages/llm-agent` defaults to Claude Haiku 5.5 at `medium` effort instead of `high`. The Security Gateway (Haiku 5.5 `medium`), the deterministic Output Guard, the prices, the USD 0.02 execution limit and the public request limits are unchanged.
- It is a versioned configuration change: the recorded subject versions name the new effort and the runtime fingerprint changes. The full 80-case × 3-repeat model-eval run on the phase pull request verifies it; the screening comparison is not a release pass.

## Why

The Main-model comparison of issue #183 (`comparison-v1`, 1 repeat on the fixed 20-case subset) measured equal quality for `high` and `medium`, apart from one S20 failure that came from the fixed Security refusal and not from Main, and `medium` was faster (p95 10.9 s against 19.3 s). `medium` leaves a margin under the p95 ≤ 20 s goal that `high` does not ([owner decision](https://github.com/sebelapetr/sebela.dev/issues/183#issuecomment-7061707787)).

## Rejected

- Keeping `high`: no measured quality gain, and its p95 sits at the edge of the latency goal.
- Sonnet 5.5 `medium`: 18 of 20 case-runs needed more Main decisions than the agent allows, so it is not viable under the product pipeline; choosing it would also need its own execution-limit decision.

## Relationship to earlier decisions

Changes the initial Main default named in the archived phase-6 PRD and eval specification (`.plan/done/06-llm-agent/`), which are not rewritten. Earlier records remain unchanged.
