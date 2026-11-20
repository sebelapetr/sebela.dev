// Whether the website can serve content now: it asks the API's readiness route, which answers only
// when the API can reach the database, and reports each part. For uptime monitoring.
import type { ApiClient } from "@sebela/api-client";

/** One part's state; `unknown` when the part in front of it failed, so it could not be asked. */
export type PartHealth = "ok" | "failing" | "unknown";

export interface HealthReport {
  readonly status: "ok" | "failing";
  readonly api: "ok" | "failing";
  readonly database: PartHealth;
}

export interface CheckHealthOptions {
  /** How long the API may take to answer; 3 seconds by default. */
  readonly timeoutMs?: number;
}

/**
 * Asks the API whether it and its database are ready. Never throws: a `null` client (the website's
 * configuration is unusable), an unreachable or slow API and any answer but "ready" or the API's
 * own `unavailable` error report the API failing; that error reports the database failing.
 */
export function checkHealth(
  client: ApiClient | null,
  options: CheckHealthOptions = {},
): Promise<HealthReport> {
  return Promise.reject(
    new Error(`not implemented: ${String(client === null)} ${String(options.timeoutMs)}`),
  );
}

/** The health route's answer: 200 when healthy, 503 otherwise; never cached and never indexed. */
export function healthResponse(report: HealthReport): Response {
  throw new Error(`not implemented: ${report.status}`);
}
