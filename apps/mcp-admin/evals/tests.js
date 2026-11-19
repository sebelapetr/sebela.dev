// @ts-check

import { implementedCases } from "./catalogue.js";

/**
 * Promptfoo test cases for the implemented catalogue entries. The description starts with the case
 * ID, so the runner selects one case with `--filter-pattern`. Variables hold the instruction only;
 * credentials and sentinels never become variables, because reports record variables.
 */
export default function generateTests() {
  return implementedCases().map((entry) => ({
    description: `${entry.id} ${entry.safety ? "(safety) " : ""}${entry.instruction}`,
    vars: { instruction: entry.instruction },
    metadata: { caseId: entry.id, language: entry.language, safety: entry.safety },
    assert: [{ type: "javascript", value: `file://graders.js:grade${entry.id}` }],
  }));
}
