# Phase 7.1 — Jev as the Security Gateway classifier

|            |                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Status     | Draft from the owner's request (2026-11-20); approved by the owner for implementation after its prerequisites                        |
| Date       | 2026-11-20                                                                                                                           |
| Parent     | `.plan/00-overview/prd.md`                                                                                                           |
| Depends on | Phase 6 merged (the Security Gateway and its eval catalogue exist). Phase 7 is not required, but its runtime gives real latency data |
| Result     | A measured decision whether TypeSafe AI's Jev replaces Haiku as the Security Gateway classifier, and a switchable adapter either way |

## Problem Statement

Every chat answer first passes the Security Gateway, which phase 6 runs as a cheap language model (`claude-haiku-5-5`, effort `medium`) that only classifies: `ALLOW`, `BLOCK` or `UNCERTAIN`, with a category and a reason code. A language model spends one to two seconds and output tokens on a decision between a few labels, and phase 6 treats its optional confidence as uncalibrated metadata.

TypeSafe AI's Jev (released September 2026) is a "System One" model built for exactly this shape of work: it does not generate text, it returns a choice among predefined options with a calibrated probability. The vendor claims 70–500 ms end-to-end responses, input at USD 0.042 per million tokens with free output, and no type errors. These are the vendor's own, self-described optimistic measurements; Czech support is not stated anywhere.

## Solution

Add Jev as a second implementation of the Security Gateway's classifier behind the existing stage contract, measure it against Haiku on the same English/Czech catalogue, and switch the configured classifier only when Jev meets every existing gate and the owner records the decision. Nothing else in the pipeline changes.

```text
question -> deterministic validation -> classifier (config: haiku | jev) -> ALLOW | BLOCK | UNCERTAIN + category + reason
                                                                       -> Main Agent / fixed response / restricted Main
```

## User Stories

1. As a visitor, I want the chat to start answering sooner, so that a portfolio question does not wait seconds for a security check.
2. As the owner, I want the classifier to be a configuration choice behind the same stage contract, so that switching back is one setting, not a code change.
3. As the owner, I want Jev measured on the same 80 English/Czech cases and the same gates as Haiku, so that the decision rests on evidence and not on vendor claims.
4. As the owner, I want Czech measured separately, so that an English-only strength cannot hide a Czech weakness.
5. As the owner, I want latency (p50/p95), cost per classification and calibration reported side by side for both classifiers.
6. As the owner, I want to know what TypeSafe AI does with the text it receives before any visitor text is sent there.
7. As a reviewer, I want a Jev outage, timeout or invalid answer to end in the same safe unavailable response as today, never in `ALLOW`.

## Implementation Decisions

### The adapter

- Introduce (or reuse, if phase 6 already has it) one classifier interface for the Security Gateway with two implementations: the current Anthropic model and Jev. The stage contract, categories, reason codes, fixed responses and `UNCERTAIN` behaviour stay exactly as in phase 6.
- Jev is asked one Choice question over the combined labels the gateway needs (verdict with category); the label set and its wording are versioned configuration, like the Haiku prompt. Jev's limit of 255 options is far above what is needed.
- Calibrated confidence: with Jev, low-confidence `ALLOW` or `BLOCK` maps to `UNCERTAIN` below a threshold chosen from the measurements and frozen before the final comparison. This changes phase 6's rule that confidence is uncalibrated metadata only for the Jev path and only through that frozen threshold; it never authorises anything on its own.
- Failure handling is unchanged: timeout, invalid response, unavailability or an exhausted allowance stop generation with the safe unavailable response. No automatic fallback from Jev to Haiku or back (phase 6 forbids automatic cross-model fallback); a different classifier is a configuration change.
- The API client follows TypeSafe AI's current documentation and Python adapter at implementation time; pin its version. Record model identifier, label-set version, threshold and pricing in the same execution metadata as the Haiku classifier.
- The key is `TYPESAFE_API_KEY` in the main checkout's `.env.secrets` (placeholder in `.env.secrets.example`), reached only through `node harness/with-secrets.mjs -- <command>`; ordinary tests use a fake classifier.

### Data boundary

- Jev receives the same bounded, validated question and context that Haiku receives today, and nothing more. It is a new external processor of visitor text, so before the first call with real visitor text the owner reviews TypeSafe AI's terms (retention, training on inputs, region, subprocessors) and the privacy information (#189) names it. Evals use fictional fixtures only.
- Local pseudonymization (phase 7) and document sensitivity checks (phase 9) stay local; Jev is not used for them.

### Measurement and decision

- Evals first: reuse phase 6's catalogue and runner; no new cases are required, but the security and false-blocking subsets run against both classifiers with 3 repeats.
- Gates are phase 6's, unchanged: every critical case-run passes, at most 5% falsely blocked legitimate questions per language, plus the end-to-end useful-answer floors with each classifier in place. A classifier that misses any gate in either language is not switched on.
- Report per language: accuracy against expected verdicts, false blocks, `UNCERTAIN` rate, calibration (expected calibration error), p50/p95 latency of the classification and of the first answer event, and cost per classification.
- The switch is a recorded owner decision (decision record) with the report linked; until then Haiku stays the configured classifier.
- Paid spend for this phase is at most USD 2 (Haiku comparison runs; Jev's cost is negligible), counted against the existing eval campaign.

## Testing Decisions

- Test-first: the label mapping, the confidence threshold to `UNCERTAIN`, and every failure path ending in the safe unavailable response, with a fake Jev client.
- Contract test that both classifiers return the same stage output type and that switching configuration changes nothing else in the pipeline.
- Paid comparison through the existing runner and secret wrapper, affected cases only during the issue, the complete security subset once for the decision.

## Out of Scope

- Using Jev for the Main Agent, Output Guard, eval grading (it returns no reasoning), tool routing, pseudonymization or document checks.
- An open-weights copy of Jev: none is identified yet ("Layla" was not found in the vendor's or Wikipedia's pages); a self-hosted classifier would be a separate decision.
- Automatic fallback between classifiers.

## Further Notes

- Prerequisites (HITL): early access from TypeSafe AI's waitlist, an API key, and the owner's review of its data terms.
- Sources checked 2026-11-20: [TypeSafe AI, Introducing System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [Jev (model umělé inteligence), Czech Wikipedia](<https://cs.wikipedia.org/wiki/Jev_(model_um%C4%9Bl%C3%A9_inteligence)>).
