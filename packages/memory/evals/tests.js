// @ts-check

import { loadDataset, planCases } from "./plan.js";

/**
 * Promptfoo test cases for the measured questions the runner names in `MEMORY_EVAL_CASES`
 * (comma-separated IDs). Pending cases never become tests. Variables hold the question only; the
 * API address and key reach the provider through its environment, never as a variable.
 */
export default function generateTests() {
  const selected = (process.env["MEMORY_EVAL_CASES"] ?? "").split(",").filter(Boolean);
  const { run } = planCases(loadDataset(), selected);
  return run.map((question) => ({
    description: `${question.id} ${question.query}`,
    vars: {
      caseId: question.id,
      query: question.query,
      kinds: JSON.stringify(question.kinds ?? null),
      limit: JSON.stringify(question.limit ?? null),
    },
    metadata: { caseId: question.id, language: question.language, category: question.category },
    assert: [{ type: "javascript", value: "file://graders/index.js:grade" }],
  }));
}
