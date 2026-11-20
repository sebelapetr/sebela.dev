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

const DEFAULT_TIMEOUT_MS = 2_000;

export function createHealthService(
  persistence: Pick<Persistence, "ping">,
  options: HealthServiceOptions = {},
): HealthService {
  return {
    async databaseReachable() {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(resolve, timeoutMs, false);
      });
      try {
        return await Promise.race([
          persistence.ping().then(
            () => true,
            () => false,
          ),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
