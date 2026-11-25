# 0029 — An uncertain abuse verdict is refused at Security

Status: accepted
Date: 2026-11-24

## Decision

The owner decided on 2026-11-23 ([#455](https://github.com/sebelapetr/sebela.dev/issues/455)) that a chat message mixing explicit abusive or hateful text with a legitimate profile question is refused as a whole: the hateful text never reaches an answer or the working context, and the visitor may ask the question again on its own.

The rule is enforced as deterministic routing in `packages/llm-agent`, not in the Security prompt. `Verdict.blocks` (`pipelines/chat/state.py`) is true for every `BLOCK` and for an `UNCERTAIN` verdict in the `abuse` category. The graph ends such a turn at Security, and the Output Guard gives it the fixed `out_of_scope` refusal with reason `blocked_abuse`, as for a `BLOCK`. The trace keeps the verdict that Security returned. Every other `UNCERTAIN` verdict still runs the restricted Main stage, and an `ALLOW` is never overridden.

## Why

- The Security policy already names abuse a blocking category, and a block has no partial-answer path. An `UNCERTAIN` verdict that names `abuse` says the classifier saw abusive content, so answering any part of the message would engage with it.
- In #393 the mixed English case was `UNCERTAIN` with category `abuse` in every repeat, so the gap is in routing, not in classification.
- Routing is deterministic and tested first. A prompt change would change every Security verdict and need a wider paid rerun to show that false blocking did not rise. This rule changes only turns that Security already marks as abuse.
- Main never runs, so no tool reads, no answer and no working-context update happen for the turn (the API advances the working context only for `answered` turns).

## Rejected

- Rewording the Security prompt so that such a message is `BLOCK`. It would make the result depend on the model again, and it would shift the verdicts of the ordinary questions too.
- Telling Main to refuse under `UNCERTAIN` when it sees abusive text. The text would still reach Main and the tools, and the outcome would depend on the model.
- Blocking every `UNCERTAIN` verdict. That would refuse the legitimate mixed requests of C12 and the cautious ordinary questions.

## Consequences

- Residual risk: a mixed message that Security labels `ALLOW`, or `UNCERTAIN` in another category, still reaches Main, which can only decline it by rule 8 of the chat prompt (`docs/threat-model.md`, row 8).
- Trade-off: every `UNCERTAIN` `abuse` verdict is now refused, so an on-topic question in an abusive tone that Security marks `UNCERTAIN` `abuse` is falsely blocked rather than answered by the restricted Main stage. This false blocking is new and unmeasured: the false-blocking cases Q19 and Q20 are polite, and no eval case sends a rude but legitimate question.
- The eval grader's `on_block` path checks only a raw `BLOCK` verdict; the C09–C11 cases grade the refusal itself, so no grader change was needed.
- The runtime fingerprint changed (`ff74122efcb8` → `7f5f7fbd340e`), so answers stored before this change are not compatible with it.
