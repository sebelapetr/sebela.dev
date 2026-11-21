// @ts-check

// Retrieval metrics of the memory evals (.plan/done/09-rag/prd.md, Evals and measurement). Pure
// functions over source IDs and the dataset's graded relevance (2 = answers the question, 1 =
// related context, absent = irrelevant); the runner and the Promptfoo grader share them.

/**
 * @typedef {Readonly<Record<string, 1 | 2>>} Relevance Graded relevance by source ID.
 *
 * @typedef {object} ObservedPassage
 * @property {string} sourceId
 * @property {string} [path] The canonical site path of a portfolio passage.
 * @property {number} [score] The passage's relevance score (the reranker's in the deployed search).
 *
 * @typedef {object} Observation What one search returned.
 * @property {"found" | "no_evidence" | "error"} status
 * @property {readonly ObservedPassage[]} passages Final passages, best first.
 * @property {readonly string[]} pool Candidate-pool source IDs, best first (repeats allowed).
 * @property {number} latencyMs The route's round trip.
 * @property {string} [error] Why the search failed, when `status` is `error`.
 *
 * @typedef {object} CaseMetrics
 * @property {boolean} answerable Whether the dataset judges any source as answering it.
 * @property {number | null} recallAtPool Share of answering sources in the candidate pool.
 * @property {number | null} ndcg nDCG over the final passages' distinct sources.
 * @property {number | null} precision Share of final passages from a relevant source.
 * @property {number | null} reciprocalRank 1 / rank of the first answering source.
 * @property {boolean} hit An answering source is among the final passages.
 * @property {boolean} correctEmpty A no-answer question returned no evidence.
 * @property {boolean} falseEmpty An answerable question returned no evidence.
 * @property {number | null} provenance Share of judged passages whose path is the expected one.
 * @property {number} latencyMs
 */

/**
 * Source IDs in first-seen order: passages and pool entries of one source count once.
 *
 * @param {readonly string[]} ids
 * @returns {string[]}
 */
export function distinct(ids) {
  return [...new Set(ids)];
}

/**
 * @param {Relevance} relevance
 * @returns {string[]} The sources graded 2.
 */
function answering(relevance) {
  return Object.keys(relevance).filter((id) => relevance[id] === 2);
}

/**
 * Recall over the candidate pool: the share of answering sources the pool contains.
 *
 * @param {readonly string[]} pool
 * @param {Relevance} relevance
 * @returns {number | null} `null` when the question has no answering source.
 */
export function recallAtPool(pool, relevance) {
  const wanted = answering(relevance);
  if (wanted.length === 0) return null;
  const seen = new Set(pool);
  return wanted.filter((id) => seen.has(id)).length / wanted.length;
}

/**
 * Normalized discounted cumulative gain of a ranking of distinct sources against the ideal one,
 * with gain `2^grade - 1` and the usual `log2(rank + 1)` discount.
 *
 * @param {readonly string[]} ranking Source IDs, best first; repeats are removed.
 * @param {Relevance} relevance
 * @param {number} k Cut-off.
 * @returns {number | null} `null` when no source is relevant.
 */
export function ndcgAtK(ranking, relevance, k) {
  const grades = Object.values(relevance).sort((a, b) => b - a);
  if (grades.length === 0) return null;
  /** @param {readonly number[]} gains */
  const dcg = (gains) =>
    gains
      .slice(0, k)
      .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const ideal = dcg(grades);
  return dcg(distinct(ranking).map((id) => relevance[id] ?? 0)) / ideal;
}

/**
 * Precision of what the search shows: the share of returned passages, up to `k`, whose source is
 * relevant (grade 1 or 2).
 *
 * @param {readonly string[]} passages Passage source IDs, best first.
 * @param {Relevance} relevance
 * @param {number} k
 * @returns {number | null} `null` when nothing was returned.
 */
export function precisionAtK(passages, relevance, k) {
  const shown = passages.slice(0, k);
  if (shown.length === 0) return null;
  return shown.filter((id) => relevance[id] !== undefined).length / shown.length;
}

/**
 * Reciprocal rank of the first answering source among the distinct passage sources.
 *
 * @param {readonly string[]} passages
 * @param {Relevance} relevance
 * @returns {number | null} `null` when the question has no answering source.
 */
export function reciprocalRank(passages, relevance) {
  if (answering(relevance).length === 0) return null;
  const rank = distinct(passages).findIndex((id) => relevance[id] === 2);
  return rank === -1 ? 0 : 1 / (rank + 1);
}

/**
 * Provenance accuracy: of the returned passages whose source the dataset knows, the share whose
 * canonical path is the dataset's path (`null` for supplemental sources, which carry none).
 *
 * @param {readonly ObservedPassage[]} passages
 * @param {Readonly<Record<string, { path: string | null }>>} sources
 * @returns {number | null} `null` when no returned passage has a known source.
 */
export function provenanceAccuracy(passages, sources) {
  const judged = passages.filter((passage) => sources[passage.sourceId] !== undefined);
  if (judged.length === 0) return null;
  const correct = judged.filter(
    (passage) => (passage.path ?? null) === sources[passage.sourceId]?.path,
  );
  return correct.length / judged.length;
}

/**
 * The value at percentile `p` (0–100) by the nearest-rank method.
 *
 * @param {readonly number[]} values
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

/**
 * Every metric of one question.
 *
 * @param {{ relevance: Relevance }} question
 * @param {Observation} observation
 * @param {Readonly<Record<string, { path: string | null }>>} sources
 * @param {number} k The final-passage cut-off.
 * @returns {CaseMetrics}
 */
export function caseMetrics(question, observation, sources, k) {
  const { relevance } = question;
  const shown = observation.passages.map((passage) => passage.sourceId);
  const answerable = answering(relevance).length > 0;
  const empty = observation.status === "no_evidence";
  return {
    answerable,
    recallAtPool: recallAtPool(observation.pool, relevance),
    ndcg: ndcgAtK(shown, relevance, k),
    precision: precisionAtK(shown, relevance, k),
    reciprocalRank: reciprocalRank(shown, relevance),
    hit: shown.slice(0, k).some((id) => relevance[id] === 2),
    correctEmpty: !answerable && empty,
    falseEmpty: answerable && empty,
    provenance: provenanceAccuracy(observation.passages, sources),
    latencyMs: observation.latencyMs,
  };
}

/**
 * Whether one question passes: an answerable question shows an answering source among its final
 * passages with correct paths, a no-answer question returns no evidence. A failed search never
 * passes.
 *
 * @param {CaseMetrics} metrics
 * @param {Observation} observation
 * @returns {{ pass: boolean, reason: string }}
 */
export function caseVerdict(metrics, observation) {
  if (observation.status === "error") {
    return { pass: false, reason: `search failed: ${observation.error ?? "unknown error"}` };
  }
  if (!metrics.answerable) {
    return metrics.correctEmpty
      ? { pass: true, reason: "no evidence, as expected" }
      : { pass: false, reason: "returned passages for a question without an answer" };
  }
  if (metrics.falseEmpty) return { pass: false, reason: "returned no evidence" };
  if (!metrics.hit) return { pass: false, reason: "no answering source among the final passages" };
  if (metrics.provenance !== null && metrics.provenance < 1) {
    return { pass: false, reason: "a passage carries the wrong canonical path" };
  }
  return { pass: true, reason: "an answering source was returned" };
}

/**
 * @param {readonly (number | null)[]} values
 * @returns {number | null} The mean of the defined values.
 */
function mean(values) {
  const defined = values.filter((value) => value !== null);
  if (defined.length === 0) return null;
  return defined.reduce((sum, value) => sum + value, 0) / defined.length;
}

/**
 * Aggregates per-question metrics into the run's measured values. Rates are over the questions
 * they apply to: correct-empty over no-answer questions, false-empty over answerable ones.
 *
 * @param {readonly CaseMetrics[]} cases
 * @param {{ queryCostUsd: number }} cost Query-embedding cost of the measured questions.
 */
export function aggregate(cases, { queryCostUsd }) {
  const answerable = cases.filter((metrics) => metrics.answerable);
  const noAnswer = cases.filter((metrics) => !metrics.answerable);
  const latencies = cases.map((metrics) => metrics.latencyMs);
  return {
    questions: cases.length,
    recallAtPool: mean(answerable.map((metrics) => metrics.recallAtPool)),
    ndcg: mean(answerable.map((metrics) => metrics.ndcg)),
    precision: mean(cases.map((metrics) => metrics.precision)),
    mrr: mean(answerable.map((metrics) => metrics.reciprocalRank)),
    hitRate:
      answerable.length === 0 ? null : answerable.filter((m) => m.hit).length / answerable.length,
    correctEmptyRate:
      noAnswer.length === 0
        ? null
        : noAnswer.filter((m) => m.correctEmpty).length / noAnswer.length,
    falseEmptyRate:
      answerable.length === 0
        ? null
        : answerable.filter((m) => m.falseEmpty).length / answerable.length,
    provenanceAccuracy: mean(cases.map((metrics) => metrics.provenance)),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    costPerQueryUsd: cases.length === 0 ? null : queryCostUsd / cases.length,
  };
}
