// @ts-check

import { catalogue, gates } from "./catalogue.js";

/**
 * The outcome of one repeat of one case: graded by Promptfoo, checked for unchanged content by the
 * runner. A case-run fails when either check fails.
 *
 * @typedef {object} CaseRun
 * @property {string} caseId
 * @property {number} repeat 1-based.
 * @property {boolean} pass
 * @property {string} reason
 */

/**
 * @typedef {object} GateResult
 * @property {boolean} pass
 * @property {string[]} failures Why the gate failed; empty when it passed.
 * @property {{ runs: number, passed: number, rate: number | null }} noncritical
 * @property {{ runs: number, passed: number }} safety
 * @property {string[]} pending Case IDs that are not implemented yet; never counted as passing.
 */

/**
 * Applies the fixed gates of the catalogue to the case-runs of one evaluation: every implemented
 * case ran the required number of repeats, at least the floor of noncritical case-runs passed and
 * every safety case-run passed. A run of an unknown or pending case is refused rather than counted.
 *
 * @param {readonly CaseRun[]} runs
 * @param {{ cases?: typeof catalogue, repeats?: number, noncriticalFloor?: number }} [options]
 * @returns {GateResult}
 */
export function evaluateGate(runs, options = {}) {
  const cases = options.cases ?? catalogue;
  const repeats = options.repeats ?? gates.repeats;
  const floor = options.noncriticalFloor ?? gates.noncriticalFloor;
  /** @type {string[]} */
  const failures = [];

  const byId = new Map(cases.map((entry) => [entry.id, entry]));
  for (const run of runs) {
    const entry = byId.get(run.caseId);
    if (!entry) failures.push(`${run.caseId}: not in the catalogue.`);
    else if (entry.status !== "implemented")
      failures.push(`${run.caseId}: pending, cannot be run.`);
  }

  const implemented = cases.filter((entry) => entry.status === "implemented");
  for (const entry of implemented) {
    const count = new Set(runs.filter((run) => run.caseId === entry.id).map((run) => run.repeat))
      .size;
    if (count < repeats)
      failures.push(`${entry.id}: ${String(count)} of ${String(repeats)} repeats ran.`);
  }

  const safetyIds = new Set(implemented.filter((entry) => entry.safety).map((entry) => entry.id));
  const noncriticalIds = new Set(
    implemented.filter((entry) => !entry.safety).map((entry) => entry.id),
  );
  const safetyRuns = runs.filter((run) => safetyIds.has(run.caseId));
  const noncriticalRuns = runs.filter((run) => noncriticalIds.has(run.caseId));

  for (const run of safetyRuns) {
    if (!run.pass)
      failures.push(`${run.caseId} repeat ${String(run.repeat)} (safety): ${run.reason}`);
  }
  const passed = noncriticalRuns.filter((run) => run.pass).length;
  const rate = noncriticalRuns.length === 0 ? null : passed / noncriticalRuns.length;
  if (rate !== null && rate < floor) {
    failures.push(
      `Noncritical success ${(rate * 100).toFixed(1)}% is below the ${(floor * 100).toFixed(0)}% floor.`,
    );
  }

  return {
    pass: failures.length === 0,
    failures,
    noncritical: { runs: noncriticalRuns.length, passed, rate },
    safety: { runs: safetyRuns.length, passed: safetyRuns.filter((run) => run.pass).length },
    pending: cases.filter((entry) => entry.status === "pending").map((entry) => entry.id),
  };
}
