import { z } from "zod";

import { invalidationSecretMinLength } from "@sebela/contracts";

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
   * Largest accepted uploaded file, `MEDIA_MAX_BYTES`, the limit the media service enforces too. An
   * upload body may exceed it only by a fixed allowance for the form around the file.
   */
  readonly uploadLimitBytes: number;
  /**
   * Addresses of reverse proxies whose `X-Forwarded-For` is believed. Empty: the client address is
   * the connection's, and forwarded headers are ignored. Addresses match exactly as the socket
   * reports them: a proxy reached over IPv4 on a dual-stack listener appears as `::ffff:<ipv4>` and
   * must be listed in that form.
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
    /** Per client, uploads, instead of the private budget; counted before the key is verified. */
    readonly upload: RatePolicy;
    /** Most callers tracked at once across all budgets; the oldest window is evicted beyond it. */
    readonly maxTrackedCallers: number;
  };
  /**
   * Where the website receives signed invalidation notifications after committed content writes,
   * and the server-only secret they are signed with. `null`: no notifications are sent.
   */
  readonly websiteInvalidation: WebsiteInvalidationConfig | null;
  /**
   * The visitor chat's HTTP settings: the website origins its writes must come from, whether its
   * cookie is `Secure`, the AI service it dispatches to and the token the AI service presents on
   * the internal control routes. `null`: the chat is off and its routes answer `unavailable`.
   */
  readonly chat: ChatHttpConfig | null;
}

export interface ChatHttpConfig {
  /** Exact origins, such as `https://www.example.test`, a visitor write must name in `Origin`. */
  readonly allowedOrigins: readonly string[];
  /** Whether the chat cookie is sent with `Secure`; `true` in production. */
  readonly cookieSecure: boolean;
  /** The AI service's base address and the bearer token it accepts from the API. */
  readonly aiService: { readonly url: string; readonly token: string };
  /** The bearer token the AI service presents on the internal control routes; never logged. */
  readonly controlToken: string;
  /**
   * The token the website's chat relay presents on every visitor chat route; never logged. Only a
   * request with it may name the visitor's address.
   */
  readonly relayToken: string;
}

export interface WebsiteInvalidationConfig {
  /** An http or https address without credentials, query or fragment. */
  readonly url: string;
  /** At least `invalidationSecretMinLength` characters; never logged. */
  readonly secret: string;
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
  API_RATE_LIMIT_UPLOAD: ratePolicy,
  MEDIA_MAX_BYTES: positive,
  API_RATE_LIMIT_MAX_TRACKED: positive,
  // Present and empty switches notifications off; set, both are validated below.
  API_WEB_INVALIDATION_URL: z.string(),
  API_WEB_INVALIDATION_SECRET: z.string(),
  // Absent or all empty switch the visitor chat off; any one set requires all, validated below.
  API_CHAT_ALLOWED_ORIGINS: z.string().optional(),
  API_CHAT_COOKIE_SECURE: z.string().optional(),
  API_AI_SERVICE_URL: z.string().optional(),
  API_AI_SERVICE_TOKEN: z.string().optional(),
  API_AI_CONTROL_TOKEN: z.string().optional(),
  API_CHAT_RELAY_TOKEN: z.string().optional(),
});

/** The shortest accepted AI service, control and relay token. */
export const chatTokenMinLength = 32;

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

/** The names of the invalidation variables that are missing or invalid, given both are present. */
function invalidInvalidationSettings(url: string, secret: string): string[] {
  if (url === "" && secret === "") return [];
  const names: string[] = [];
  if (!isPlainWebAddress(url)) names.push("API_WEB_INVALIDATION_URL");
  if (secret.length < invalidationSecretMinLength) names.push("API_WEB_INVALIDATION_SECRET");
  return names;
}

/** An exact web origin: http or https, a host and maybe a port, nothing else. */
function isWebOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
}

type ChatEnvironment = Pick<
  z.infer<typeof ApiEnvironmentSchema>,
  | "API_CHAT_ALLOWED_ORIGINS"
  | "API_CHAT_COOKIE_SECURE"
  | "API_AI_SERVICE_URL"
  | "API_AI_SERVICE_TOKEN"
  | "API_AI_CONTROL_TOKEN"
  | "API_CHAT_RELAY_TOKEN"
>;

/**
 * The chat settings, `null` when none of the origins, AI service or tokens is given, or the names of
 * the variables that are missing or invalid. The cookie flag alone does not switch the chat on.
 */
function readChatSettings(settings: ChatEnvironment): ChatHttpConfig | null | string[] {
  const originsText = settings.API_CHAT_ALLOWED_ORIGINS ?? "";
  const secureText = settings.API_CHAT_COOKIE_SECURE ?? "";
  const url = settings.API_AI_SERVICE_URL ?? "";
  const token = settings.API_AI_SERVICE_TOKEN ?? "";
  const controlToken = settings.API_AI_CONTROL_TOKEN ?? "";
  const relayToken = settings.API_CHAT_RELAY_TOKEN ?? "";
  if ([originsText, url, token, controlToken, relayToken].every((value) => value === "")) {
    return null;
  }
  const origins = originsText
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const names: string[] = [];
  if (origins.length === 0 || !origins.every(isWebOrigin)) names.push("API_CHAT_ALLOWED_ORIGINS");
  if (secureText !== "true" && secureText !== "false") names.push("API_CHAT_COOKIE_SECURE");
  if (!isPlainWebAddress(url)) names.push("API_AI_SERVICE_URL");
  if (token.length < chatTokenMinLength) names.push("API_AI_SERVICE_TOKEN");
  if (controlToken.length < chatTokenMinLength || controlToken === token) {
    names.push("API_AI_CONTROL_TOKEN");
  }
  if (
    relayToken.length < chatTokenMinLength ||
    relayToken === token ||
    relayToken === controlToken
  ) {
    names.push("API_CHAT_RELAY_TOKEN");
  }
  if (names.length > 0) return names;
  return {
    allowedOrigins: origins,
    cookieSecure: secureText === "true",
    aiService: { url, token },
    controlToken,
    relayToken,
  };
}

/** Names the variables to fix; their values are never included. */
const configurationError = (names: readonly string[]) =>
  new Error(`Invalid API configuration: set ${names.join(", ")} (documented in .env.example)`);

/**
 * Reads the API settings from an environment such as `process.env`. Throws an error naming every
 * missing or invalid variable; there are no fallbacks. Values are never included in it.
 */
export function readApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const parsed = ApiEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw configurationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  }
  const settings = parsed.data;
  const url = settings.API_WEB_INVALIDATION_URL;
  const secret = settings.API_WEB_INVALIDATION_SECRET;
  const invalid = invalidInvalidationSettings(url, secret);
  const chat = readChatSettings(settings);
  const problems = [...invalid, ...(Array.isArray(chat) ? chat : [])];
  if (problems.length > 0) throw configurationError(problems);
  return {
    host: settings.API_HOST,
    port: settings.API_PORT,
    bodyLimitBytes: settings.API_BODY_LIMIT_BYTES,
    uploadLimitBytes: settings.MEDIA_MAX_BYTES,
    trustedProxies: settings.API_TRUSTED_PROXIES,
    rateLimits: {
      health: settings.API_RATE_LIMIT_HEALTH,
      public: settings.API_RATE_LIMIT_PUBLIC,
      private: settings.API_RATE_LIMIT_PRIVATE,
      key: settings.API_RATE_LIMIT_KEY,
      upload: settings.API_RATE_LIMIT_UPLOAD,
      maxTrackedCallers: settings.API_RATE_LIMIT_MAX_TRACKED,
    },
    websiteInvalidation: url === "" ? null : { url, secret },
    chat: Array.isArray(chat) ? null : chat,
  };
}
