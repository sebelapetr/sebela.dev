import { z } from "zod";

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

const positive = z.coerce.number().int().positive();

/** `<max>/<seconds>`, both positive whole numbers. */
const ratePolicy = z
  .string()
  .regex(/^\d+\/\d+$/)
  .transform((value) => value.split("/").map(Number) as [number, number])
  .refine(([max, seconds]) => max > 0 && seconds > 0)
  .transform(([max, seconds]): RatePolicy => ({ max, windowMs: seconds * 1000 }));

const ApiEnvironmentSchema = z.object({
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().min(0).max(65535),
  API_BODY_LIMIT_BYTES: positive,
  API_TRUSTED_PROXIES: z
    .string()
    .transform((value) => value.split(",").map((address) => address.trim()))
    .transform((addresses) => addresses.filter((address) => address.length > 0)),
  API_RATE_LIMIT_HEALTH: ratePolicy,
  API_RATE_LIMIT_PUBLIC: ratePolicy,
  API_RATE_LIMIT_PRIVATE: ratePolicy,
  API_RATE_LIMIT_KEY: ratePolicy,
  API_RATE_LIMIT_MAX_TRACKED: positive,
});

/**
 * Reads the API settings from an environment such as `process.env`. Throws an error naming every
 * missing or invalid variable; there are no fallbacks. Values are never included in it.
 */
export function readApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const parsed = ApiEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(
      `Invalid API configuration: set ${names.join(", ")} (documented in .env.example)`,
    );
  }
  const settings = parsed.data;
  return {
    host: settings.API_HOST,
    port: settings.API_PORT,
    bodyLimitBytes: settings.API_BODY_LIMIT_BYTES,
    trustedProxies: settings.API_TRUSTED_PROXIES,
    rateLimits: {
      health: settings.API_RATE_LIMIT_HEALTH,
      public: settings.API_RATE_LIMIT_PUBLIC,
      private: settings.API_RATE_LIMIT_PRIVATE,
      key: settings.API_RATE_LIMIT_KEY,
      maxTrackedCallers: settings.API_RATE_LIMIT_MAX_TRACKED,
    },
  };
}
