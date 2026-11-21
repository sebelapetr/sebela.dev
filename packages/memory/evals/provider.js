// @ts-check

// The Promptfoo provider of the memory evals: sends one question to the private search route and
// returns what it observed as JSON for the grader. It reads the route's address and API key from
// its environment (set by the runner) and the candidate pools the runner computed beforehand; it
// never sees the embedding provider's key.
import { readFileSync } from "node:fs";

/** The longest a search may take before the case counts as failed. */
const TIMEOUT_MS = 30_000;

export default class SearchRouteProvider {
  id() {
    return "sebela-retrieval-search";
  }

  /**
   * @param {string} _prompt
   * @param {{ vars: Record<string, unknown> }} context
   */
  async callApi(_prompt, context) {
    const caseId = String(context.vars["caseId"]);
    const kinds = JSON.parse(String(context.vars["kinds"] ?? "null"));
    const limit = JSON.parse(String(context.vars["limit"] ?? "null"));
    const observation = await search({
      query: String(context.vars["query"]),
      ...(kinds === null ? {} : { kinds }),
      ...(limit === null ? {} : { limit }),
    });
    return { output: JSON.stringify({ ...observation, pool: poolOf(caseId) }) };
  }
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<Omit<import("./graders/metrics.js").Observation, "pool">>}
 */
async function search(body) {
  const url = new URL("/v1/retrieval/search", required("MEMORY_EVAL_API_URL"));
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${required("MEMORY_EVAL_KEY")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - started);
    const payload = /** @type {any} */ (await response.json().catch(() => null));
    if (!response.ok) {
      const code = payload?.error?.code ?? "unknown";
      return {
        status: "error",
        passages: [],
        latencyMs,
        error: `${String(response.status)} ${code}`,
      };
    }
    return {
      status: payload.status,
      passages: payload.passages.map(
        (/** @type {{ sourceId: string, path?: string, score: number }} */ passage) => ({
          sourceId: passage.sourceId,
          ...(passage.path === undefined ? {} : { path: passage.path }),
          score: passage.score,
        }),
      ),
      latencyMs,
    };
  } catch (error) {
    return {
      status: "error",
      passages: [],
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The candidate pool the runner recorded for the case, as source IDs.
 *
 * @param {string} caseId
 * @returns {string[]}
 */
function poolOf(caseId) {
  /** @type {Record<string, string[]>} */
  const pools = JSON.parse(readFileSync(required("MEMORY_EVAL_POOLS"), "utf8"));
  return pools[caseId] ?? [];
}

/** @param {string} name */
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run the evals through evals/run.js.`);
  return value;
}
