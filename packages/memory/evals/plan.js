// @ts-check

// The question set and which of its cases the system can answer yet. A case whose capability is
// not searchable is reported pending — never passed — until the slice that adds it (supplemental
// documents arrive with ingest and approval, .plan/09-rag/prd.md).
import { readFileSync } from "node:fs";

/**
 * @typedef {"portfolio" | "supplemental"} Capability
 *
 * @typedef {object} Question
 * @property {string} id
 * @property {"en" | "cs"} language
 * @property {string} category
 * @property {string} query
 * @property {Capability} requires What must be searchable to answer it.
 * @property {Readonly<Record<string, 1 | 2>>} relevance Graded relevance by source ID.
 * @property {readonly string[]} [kinds] A content-kind filter for the search.
 * @property {number} [limit] A passage limit for the search.
 * @property {string} [note]
 *
 * @typedef {object} Dataset
 * @property {number} version
 * @property {Readonly<Record<string, { path: string | null }>>} sources Canonical paths of judged sources.
 * @property {readonly { sourceId: string, title: string, file: string }[]} documents
 * @property {readonly Question[]} questions
 *
 * @typedef {{ id: string, reason: string }} PendingCase
 */

/**
 * What the search route can answer today. Empty until the vector baseline exists: every case is
 * pending, so the runner can never report a pass for search that is not implemented.
 *
 * @type {ReadonlySet<Capability>}
 */
export const SEARCHABLE = new Set();

/** @returns {Dataset} */
export function loadDataset() {
  return JSON.parse(readFileSync(new URL("datasets/questions.json", import.meta.url), "utf8"));
}

/**
 * Splits the selected cases into those the runner measures and those that stay pending. An empty
 * selection means every case; an unknown or repeated ID is an error.
 *
 * @param {Dataset} dataset
 * @param {readonly string[]} selected
 * @param {ReadonlySet<Capability>} [searchable]
 * @returns {{ run: Question[], pending: PendingCase[] }}
 */
export function planCases(dataset, selected, searchable = SEARCHABLE) {
  const byId = new Map(dataset.questions.map((question) => [question.id, question]));
  const repeated = selected.filter((id, index) => selected.indexOf(id) !== index);
  if (repeated.length > 0) throw new Error(`Repeated case: ${repeated.join(", ")}`);
  const unknown = selected.filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new Error(`Unknown case: ${unknown.join(", ")}`);
  const chosen =
    selected.length === 0
      ? dataset.questions
      : selected.map((id) => /** @type {Question} */ (byId.get(id)));
  /** @type {Question[]} */
  const run = [];
  /** @type {PendingCase[]} */
  const pending = [];
  for (const question of chosen) {
    if (searchable.has(question.requires)) run.push(question);
    else
      pending.push({ id: question.id, reason: `${question.requires} search is not available yet` });
  }
  return { run, pending };
}

/**
 * Marks every case pending for one reason, such as a missing provider key.
 *
 * @param {{ run: Question[], pending: PendingCase[] }} plan
 * @param {string} reason
 * @returns {PendingCase[]}
 */
export function allPending(plan, reason) {
  return [...plan.run.map((question) => ({ id: question.id, reason })), ...plan.pending];
}
