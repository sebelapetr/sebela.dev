import { z } from "zod";

/** A fixed-window budget: at most `max` requests per `windowMs` for one caller. */
export interface RatePolicy {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * The validated settings of the MCP Admin process. Read once where the process starts and passed
 * down; nothing below reads the environment again. There is no API key here: every caller presents
 * its own, and MCP Admin keeps none.
 */
export interface McpAdminConfig {
  /** Interface and port to listen on. Port 0 picks a free one. */
  readonly host: string;
  readonly port: number;
  /** The content API's base address: its origin, or an origin with a path prefix before `/v1`. */
  readonly apiUrl: string;
  /** Host names (without port) a request's `Host` may name; anything else is refused. */
  readonly allowedHosts: readonly string[];
  /** Host names a present `Origin` may name. Empty: every request with an `Origin` is refused. */
  readonly allowedOrigins: readonly string[];
  /** Reverse proxies whose `X-Forwarded-For` is believed, as the socket reports their address. */
  readonly trustedProxies: readonly string[];
  /** Largest accepted request body, enforced while it is received. */
  readonly bodyLimitBytes: number;
  /** Longest an MCP request may take, its content API calls included. */
  readonly timeoutMs: number;
  /** Most MCP requests in progress at once; beyond it a request is refused at once. */
  readonly maxConcurrent: number;
  readonly rateLimits: {
    /** Per client address, every request except health, counted before its key is checked. */
    readonly preAuth: RatePolicy;
    /** Per verified API key. */
    readonly key: RatePolicy;
    /** Most callers tracked at once across both budgets; the oldest window is evicted beyond it. */
    readonly maxTracked: number;
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

/** A comma-separated list; blank entries are dropped. */
const list = z
  .string()
  .transform((value) => value.split(",").map((entry) => entry.trim()))
  .transform((entries) => entries.filter((entry) => entry.length > 0));

/** A plain http or https address: no credentials, query or fragment that could carry a secret. */
function isPlainWebAddress(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

const McpAdminEnvironmentSchema = z.object({
  MCP_ADMIN_HOST: z.string().min(1),
  MCP_ADMIN_PORT: z.coerce.number().int().min(0).max(65535),
  MCP_ADMIN_API_URL: z.string().refine(isPlainWebAddress),
  MCP_ADMIN_ALLOWED_HOSTS: list.refine((hosts) => hosts.length > 0),
  MCP_ADMIN_ALLOWED_ORIGINS: list,
  MCP_ADMIN_TRUSTED_PROXIES: list,
  MCP_ADMIN_BODY_LIMIT_BYTES: positive,
  MCP_ADMIN_TIMEOUT_MS: positive,
  MCP_ADMIN_MAX_CONCURRENT: positive,
  MCP_ADMIN_RATE_LIMIT_PREAUTH: ratePolicy,
  MCP_ADMIN_RATE_LIMIT_KEY: ratePolicy,
  MCP_ADMIN_RATE_LIMIT_MAX_TRACKED: positive,
});

/**
 * Reads the MCP Admin settings from an environment such as `process.env`. Throws an error naming
 * every missing or invalid variable; there are no fallbacks. Values are never included in it.
 */
export function readMcpAdminConfig(
  env: Readonly<Record<string, string | undefined>>,
): McpAdminConfig {
  const parsed = McpAdminEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(
      `Invalid MCP Admin configuration: set ${names.join(", ")} (documented in .env.example)`,
    );
  }
  const settings = parsed.data;
  return {
    host: settings.MCP_ADMIN_HOST,
    port: settings.MCP_ADMIN_PORT,
    apiUrl: settings.MCP_ADMIN_API_URL.replace(/\/+$/, ""),
    allowedHosts: settings.MCP_ADMIN_ALLOWED_HOSTS,
    allowedOrigins: settings.MCP_ADMIN_ALLOWED_ORIGINS,
    trustedProxies: settings.MCP_ADMIN_TRUSTED_PROXIES,
    bodyLimitBytes: settings.MCP_ADMIN_BODY_LIMIT_BYTES,
    timeoutMs: settings.MCP_ADMIN_TIMEOUT_MS,
    maxConcurrent: settings.MCP_ADMIN_MAX_CONCURRENT,
    rateLimits: {
      preAuth: settings.MCP_ADMIN_RATE_LIMIT_PREAUTH,
      key: settings.MCP_ADMIN_RATE_LIMIT_KEY,
      maxTracked: settings.MCP_ADMIN_RATE_LIMIT_MAX_TRACKED,
    },
  };
}
