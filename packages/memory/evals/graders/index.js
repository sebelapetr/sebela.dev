// @ts-check

// The Promptfoo grader of the memory evals: scores the search the provider observed for one
// question against the dataset's graded relevance. No model is involved.
import { loadDataset } from "../plan.js";
import { caseMetrics, caseVerdict } from "./metrics.js";

/** The final-passage cut-off of nDCG and precision: the route's largest limit. */
export const CUTOFF = 8;

const dataset = loadDataset();

/**
 * @param {string} output The provider's JSON observation.
 * @param {{ vars: Record<string, unknown> }} context
 */
export function grade(output, context) {
  const caseId = String(context.vars["caseId"]);
  const question = dataset.questions.find((entry) => entry.id === caseId);
  if (!question) return { pass: false, score: 0, reason: `unknown case ${caseId}` };
  /** @type {import("./metrics.js").Observation} */
  const observation = JSON.parse(output);
  const metrics = caseMetrics(question, observation, dataset.sources, CUTOFF);
  const verdict = caseVerdict(metrics, observation);
  /** @type {Record<string, number>} */
  const namedScores = { latencyMs: metrics.latencyMs };
  for (const name of /** @type {const} */ ([
    "recallAtPool",
    "ndcg",
    "precision",
    "reciprocalRank",
    "provenance",
  ])) {
    const value = metrics[name];
    if (value !== null) namedScores[name] = value;
  }
  return {
    pass: verdict.pass,
    score: verdict.pass ? 1 : 0,
    reason: verdict.reason,
    namedScores,
  };
}
