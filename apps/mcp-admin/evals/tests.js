// @ts-check

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { implementedCases } from "./catalogue.js";
import { scenarios } from "./scenarios.js";

const skillsFolder = new URL("../../../.claude/skills/", import.meta.url);

/**
 * Promptfoo test cases for the implemented catalogue entries. The description starts with the case
 * ID, so the runner selects one case with `--filter-pattern`. Variables hold the owner's message and
 * the applicable content skill only; credentials and sentinels never become variables, because
 * reports record variables.
 */
export default function generateTests() {
  return implementedCases().map((entry) => {
    const scenario = scenarios[entry.id];
    if (!scenario) throw new Error(`${entry.id} has no scenario.`);
    return {
      description: `${entry.id} ${entry.safety ? "(safety) " : ""}${entry.instruction}`,
      vars: {
        instruction: scenario.prompt,
        skill: scenario.skill ? skillText(scenario.skill) : "",
      },
      metadata: { caseId: entry.id, language: entry.language, safety: entry.safety },
      assert: [{ type: "javascript", value: `file://graders.js:grade${entry.id}` }],
    };
  });
}

/**
 * The content skill as the model receives it: the repository's skill file without its front matter.
 *
 * @param {string} name
 * @returns {string}
 */
export function skillText(name) {
  const text = readFileSync(fileURLToPath(new URL(`${name}/SKILL.md`, skillsFolder)), "utf8");
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}
