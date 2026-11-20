// Whether the website can serve content now: it asks the API's readiness route, which answers only
// when the API can reach the database, and reports each part. For uptime monitoring.
import type { ApiClient } from "@sebela/api-client";

/** One part's state; `unknown` when the part in front of it failed, so it could not be asked. */
export type PartHealth = "ok" | "failing" | "unknown";

export interface HealthReport {
  readonly status: "ok" | "failing";
  readonly api: "ok" | "failing";
  readonly postgres: PartHealth;
}

export interface CheckHealthOptions {
  /** How long the API may take to answer; 3 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;

const HEALTHY: HealthReport = { status: "ok", api: "ok", postgres: "ok" };
const DATABASE_FAILING: HealthReport = { status: "failing", api: "ok", postgres: "failing" };
const API_FAILING: HealthReport = { status: "failing", api: "failing", postgres: "unknown" };

/**
 * Asks the API whether it and its database are ready. Never throws: a `null` client (the website's
 * configuration is unusable), an unreachable or slow API and any answer but "ready" or the API's
 * own `unavailable` error report the API failing; that error reports the database failing.
 */
export async function checkHealth(
  client: ApiClient | null,
  options: CheckHealthOptions = {},
): Promise<HealthReport> {
  if (client === null) return API_FAILING;
  try {
    const { data, error, response } = await client.GET("/health/ready", {
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 200 && data?.status === "ready") return HEALTHY;
    if (response.status === 503 && error?.error.code === "unavailable") return DATABASE_FAILING;
    return API_FAILING;
  } catch {
    // Unreachable, timed out or an answer that is not the API's JSON.
    return API_FAILING;
  }
}

export interface ReuseRecentHealthOptions {
  /** How long a report is reused. */
  readonly maxAgeMs: number;
  /** The clock, in milliseconds; `Date.now` by default. */
  readonly now?: () => number;
}

/** Not implemented yet. */
export function reuseRecentHealth(
  check: () => Promise<HealthReport>,
  options: ReuseRecentHealthOptions,
): () => Promise<HealthReport> {
  throw new Error(`not implemented: ${String(options.maxAgeMs)} ${check.name}`);
}

/** The health route's answer: 200 when healthy, 503 otherwise; never cached and never indexed. */
export function healthResponse(report: HealthReport): Response {
  return Response.json(
    { status: report.status, api: report.api, postgres: report.postgres },
    {
      status: report.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    },
  );
}
