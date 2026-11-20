import type { Persistence } from "@sebela/db";

/**
 * Whether the backend can serve content now, for readiness checks and uptime monitoring.
 *
 * - `databaseReachable`: true when the database answers a trivial query within the time limit;
 *   false when it refuses, fails or does not answer in time. Never throws and reveals no detail of
 *   the failure.
 */
export interface HealthService {
  databaseReachable(): Promise<boolean>;
}

export interface HealthServiceOptions {
  /** How long the database may take to answer; 2 seconds by default. */
  readonly timeoutMs?: number;
}

export function createHealthService(
  persistence: Pick<Persistence, "ping">,
  options: HealthServiceOptions = {},
): HealthService {
  return {
    databaseReachable: () =>
      Promise.reject(new Error(`not implemented: ${typeof persistence}, ${typeof options}`)),
  };
}
