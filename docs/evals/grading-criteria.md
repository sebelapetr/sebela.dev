# Grading criteria

When a person or a model grades sampled answers at a phase acceptance, the scores are only comparable with earlier ones if the yardstick is known. This file keeps the wording of the grading criteria, one version per wording, and says what is recorded with every grade ([#309](https://github.com/sebelapetr/sebela.dev/issues/309)).

The grading criteria are what the grader is shown: the dimensions, the scale, what each score means and any instruction on how to check an answer. `criteria-v<n>` is the one scheme for them: it is the versioned grounding, relevance and language rubric that [#215](https://github.com/sebelapetr/sebela.dev/issues/215) describes for the human-review queue, so that work adds its wording here and starts no second scheme. They are separate from the judge's rubric (`rubric-v<n>` in `packages/llm-agent/evals/graders/rubric.py`), which the model judge applies during a run.

## Versioning rule

- A version is named `criteria-v<n>`, with `n` counted from 1.
- Any change to the wording shown to the grader makes a new version: a dimension, the scale, the meaning of a score, an instruction. A typo fix that changes no meaning does too; the identifier is cheap and the doubt is not.
- A version's text is added to this file, under its own heading, **before** the first grade is given under it.
- A version that has been used is never edited or removed. A correction is a new version.
- Grades given under different versions are not pooled or compared as one series without saying so.

## What is recorded with every grade

A set of grades (the comment on the acceptance issue and the phase's report in this folder) states:

| Field                | Meaning                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| Criteria version     | `criteria-v<n>` from this file                                                   |
| Run                  | The run whose stored answers were graded, and its commit                         |
| Runtime version      | The runtime fingerprint of that run                                              |
| Expectations version | The expectations version of that run                                             |
| Subject              | The subject's models and efforts in that run                                     |
| Judge                | The judge model and effort and its rubric version (`rubric-v<n>`)                |
| Who or what graded   | A person, or a model with its identifier, and on whose delegation; with the date |
| Case-run and scores  | One line per graded answer, with a note for each score below 4                   |

A grade given by a model is recorded as a model grade and is never called a human grade.

## Versions

### Phase 06: no version

The 12 answers graded at the phase 06 acceptance have **no criteria version: the wording given to the grader is not recorded** on [#183](https://github.com/sebelapetr/sebela.dev/issues/183) or in this repository, and it is not reconstructed here.

What the record does state ([graded answers](https://github.com/sebelapetr/sebela.dev/issues/183#issuecomment-7068487666)):

- Scores from 1 to 5 for three dimensions: grounding, relevance and language, with a note for each score below 4.
- The grader was a model, Claude (`claude-fable-5-2`), on the owner's delegation, on 2026-11-21. It checked each claim against the eval fixture and the tool results stored with each answer.
- Run `run-20261121T191400Z-2158998`, commit `09ee54d`, runtime `f6f96186b735`, expectations `expectations-711dd5c49d2c`.
- Subject: Security and Main `claude-haiku-5-5` at `medium`. Judge: `claude-sonnet-5-5` at `medium`, `rubric-v5`.

These grades are therefore not comparable, score for score, with grades given under a later version. The report is [06-llm-agent.md](06-llm-agent.md).

### criteria-v1

Not written yet. The first phase that grades under this rule adds its wording here before grading starts: the phase 07 human grading ([#215](https://github.com/sebelapetr/sebela.dev/issues/215), [#216](https://github.com/sebelapetr/sebela.dev/issues/216)).
