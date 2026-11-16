/** A fixed-window budget: at most `max` requests per `windowMs` for one caller. */
export interface RatePolicy {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * The validated settings of the API process. Read once where the process starts and passed down;
 * nothing below reads the environment again.
 */
export interface ApiConfig {
  /** Interface and port to listen on. Port 0 picks a free one. */
  readonly host: string;
  readonly port: number;
  /** Largest accepted request body, enforced while it is received. */
  readonly bodyLimitBytes: number;
  /**
   * Addresses of reverse proxies whose `X-Forwarded-For` is believed. Empty: the client address is
   * the connection's, and forwarded headers are ignored.
   */
  readonly trustedProxies: readonly string[];
  readonly rateLimits: {
    /** Per client, `/health` only, apart from every other budget. */
    readonly health: RatePolicy;
    /** Per client, public routes, the OpenAPI document, the reference and unknown routes. */
    readonly public: RatePolicy;
    /** Per client, private routes, counted before the key is verified. */
    readonly private: RatePolicy;
    /** Per verified API key, private routes. */
    readonly key: RatePolicy;
    /** Most callers tracked at once across all budgets; the oldest window is evicted beyond it. */
    readonly maxTrackedCallers: number;
  };
}

/**
 * Reads the API settings from an environment such as `process.env`. Throws an error naming every
 * missing or invalid variable; there are no fallbacks. Values are never included in it.
 */
export function readApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  throw new Error(`Not implemented yet (${String(Object.keys(env).length)} variables).`);
}
