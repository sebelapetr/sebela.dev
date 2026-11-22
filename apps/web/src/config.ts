import { z } from "zod";

import { invalidationSecretMinLength } from "@sebela/contracts";

import { parseMediaBase } from "./media-source";

/** The website's settings, read once from the environment at request time. */
export interface WebConfig {
  /** The API's base address, without a trailing slash. */
  readonly apiBaseUrl: string;
  /** The site's canonical public origin, without a trailing slash. */
  readonly siteOrigin: string;
  /**
   * The media files' base address, without a trailing slash: the storage's public address with its
   * environment folder and, in a worktree, its worktree folder, as the API names its files. Only
   * files directly below it are shown or downloaded.
   */
  readonly mediaBaseUrl: string;
  /**
   * Where the website's server reads the files below `mediaBaseUrl`, without a trailing slash:
   * `WEB_MEDIA_READ_BASE_URL`, such as the API's internal address in a container, or the media
   * base itself when unset or empty. Never named to a visitor.
   */
  readonly mediaReadBaseUrl: string;
  /**
   * The content cache's fallback revalidation interval in milliseconds, independent of
   * invalidation notifications: `WEB_CONTENT_REVALIDATE_SECONDS`, 60 seconds when unset or empty.
   */
  readonly contentRevalidateMs: number;
}

const apiBaseUrl = z
  .string({ error: "is required" })
  .min(1, { error: "is required" })
  .transform((value, context) => {
    const problem = (message: string) => {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return problem("must be an http or https address");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return problem("must be an http or https address");
    }
    if (url.username !== "" || url.password !== "") return problem("must not contain credentials");
    if (value.includes("?") || value.includes("#")) {
      return problem("must not have a query or a fragment");
    }
    return url.href.replace(/\/+$/u, "");
  });

const siteOrigin = z
  .string({ error: "is required" })
  .min(1, { error: "is required" })
  .transform((value, context) => {
    const problem = (message: string) => {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return problem("must be an http or https origin");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return problem("must be an http or https origin");
    }
    if (url.username !== "" || url.password !== "") return problem("must not contain credentials");
    if (url.pathname !== "/" || value.includes("?") || value.includes("#")) {
      return problem("must be an origin only, without a path, query or fragment");
    }
    return url.origin;
  });

const mediaBaseUrl = z
  .string({ error: "is required" })
  .min(1, { error: "is required" })
  .transform((value, context) => {
    const base = parseMediaBase(value);
    if (typeof base === "string") {
      context.addIssue({ code: "custom", message: base });
      return z.NEVER;
    }
    return base.href;
  });

const mediaReadBaseUrl = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined || value === "") return undefined;
    const base = parseMediaBase(value);
    if (typeof base === "string") {
      context.addIssue({ code: "custom", message: base });
      return z.NEVER;
    }
    return base.href;
  });

/** The fallback revalidation interval when `WEB_CONTENT_REVALIDATE_SECONDS` is unset or empty. */
const DEFAULT_CONTENT_REVALIDATE_SECONDS = 60;
/** The longest accepted interval: a day. */
const MAX_CONTENT_REVALIDATE_SECONDS = 86_400;

const contentRevalidateMs = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined || value === "") return DEFAULT_CONTENT_REVALIDATE_SECONDS * 1000;
    const seconds = /^[1-9][0-9]*$/u.test(value) ? Number(value) : Number.NaN;
    if (!(seconds <= MAX_CONTENT_REVALIDATE_SECONDS)) {
      context.addIssue({
        code: "custom",
        message: `must be a whole number of seconds from 1 to ${String(MAX_CONTENT_REVALIDATE_SECONDS)}`,
      });
      return z.NEVER;
    }
    return seconds * 1000;
  });

const schema = z.object({
  WEB_API_BASE_URL: apiBaseUrl,
  WEB_SITE_ORIGIN: siteOrigin,
  WEB_MEDIA_BASE_URL: mediaBaseUrl,
  WEB_MEDIA_READ_BASE_URL: mediaReadBaseUrl,
  WEB_CONTENT_REVALIDATE_SECONDS: contentRevalidateMs,
});

/**
 * Reads the website's settings from an environment such as `process.env`. Throws an error naming
 * every invalid variable and what is wrong with it, never its value.
 */
export function readWebConfig(env: Readonly<Record<string, string | undefined>>): WebConfig {
  const result = schema.safeParse({
    WEB_API_BASE_URL: env["WEB_API_BASE_URL"],
    WEB_SITE_ORIGIN: env["WEB_SITE_ORIGIN"],
    WEB_MEDIA_BASE_URL: env["WEB_MEDIA_BASE_URL"],
    WEB_MEDIA_READ_BASE_URL: env["WEB_MEDIA_READ_BASE_URL"],
    WEB_CONTENT_REVALIDATE_SECONDS: env["WEB_CONTENT_REVALIDATE_SECONDS"],
  });
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
    throw new Error(
      `Invalid website configuration (documented in .env.example): ${problems.join("; ")}`,
    );
  }
  return {
    apiBaseUrl: result.data.WEB_API_BASE_URL,
    siteOrigin: result.data.WEB_SITE_ORIGIN,
    mediaBaseUrl: result.data.WEB_MEDIA_BASE_URL,
    mediaReadBaseUrl: result.data.WEB_MEDIA_READ_BASE_URL ?? result.data.WEB_MEDIA_BASE_URL,
    contentRevalidateMs: result.data.WEB_CONTENT_REVALIDATE_SECONDS,
  };
}

/** Shortest accepted invalidation signing secret, as `@sebela/contracts` requires. */
const INVALIDATION_SECRET_MIN_LENGTH = invalidationSecretMinLength;

/**
 * Reads the server-only secret the API's invalidation notifications are signed with
 * (`WEB_INVALIDATION_SECRET`, the same value as the API's `API_WEB_INVALIDATION_SECRET`). Separate
 * from `readWebConfig`, so pages render without it; only the invalidation receiver needs it. Throws
 * an error naming the variable, never its value, when it is missing or shorter than 32 characters.
 */
export function readInvalidationSecret(env: Readonly<Record<string, string | undefined>>): string {
  const value = env["WEB_INVALIDATION_SECRET"];
  if (value === undefined || value === "") {
    throw new Error(
      "Invalid website configuration (documented in .env.example): WEB_INVALIDATION_SECRET is required",
    );
  }
  if (value.length < INVALIDATION_SECRET_MIN_LENGTH) {
    throw new Error(
      `Invalid website configuration (documented in .env.example): WEB_INVALIDATION_SECRET must be at least ${String(INVALIDATION_SECRET_MIN_LENGTH)} characters`,
    );
  }
  return value;
}

/**
 * The optional analytics integration's settings: an Umami-compatible tracker script and the
 * website's identifier on that service. Both come from the server environment at request time.
 */
export interface AnalyticsConfig {
  /** The tracker script's address: https, or plain http only on a plain http site. */
  readonly scriptUrl: string;
  /** The website's identifier on the analytics service, a UUID in lower case. */
  readonly websiteId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function analyticsScriptProblem(value: string, siteOrigin: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an https address";
  }
  // A plain http tracker would be blocked as mixed content on an https site; local and test sites
  // run on plain http and use a local stand-in.
  const sitePlainHttp = siteOrigin?.startsWith("http:") === true;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && sitePlainHttp)) {
    return "must be an https address";
  }
  if (url.username !== "" || url.password !== "") return "must not contain credentials";
  if (value.includes("?") || value.includes("#")) return "must not have a query or a fragment";
  if (url.pathname === "/") return "must name the tracker script, not only a host";
  return null;
}

/**
 * Reads the optional analytics settings (`WEB_ANALYTICS_SCRIPT_URL`, `WEB_ANALYTICS_WEBSITE_ID`)
 * from an environment such as `process.env`. Null when both are unset or empty: analytics is off.
 * Separate from `readWebConfig`, so a wrong analytics setting never stops a page. Throws an error
 * naming every invalid variable and what is wrong with it, never its value, when only one is set
 * or either is unusable.
 */
export function readAnalyticsConfig(
  env: Readonly<Record<string, string | undefined>>,
): AnalyticsConfig | null {
  const scriptUrl = env["WEB_ANALYTICS_SCRIPT_URL"] ?? "";
  const websiteId = env["WEB_ANALYTICS_WEBSITE_ID"] ?? "";
  if (scriptUrl === "" && websiteId === "") return null;
  const problems: string[] = [];
  if (scriptUrl === "") {
    problems.push("WEB_ANALYTICS_SCRIPT_URL is required with WEB_ANALYTICS_WEBSITE_ID");
  } else {
    const problem = analyticsScriptProblem(scriptUrl, env["WEB_SITE_ORIGIN"]);
    if (problem !== null) problems.push(`WEB_ANALYTICS_SCRIPT_URL ${problem}`);
  }
  if (websiteId === "") {
    problems.push("WEB_ANALYTICS_WEBSITE_ID is required with WEB_ANALYTICS_SCRIPT_URL");
  } else if (!UUID.test(websiteId)) {
    problems.push("WEB_ANALYTICS_WEBSITE_ID must be a UUID");
  }
  if (problems.length > 0) {
    throw new Error(
      `Invalid website configuration (documented in .env.example): ${problems.join("; ")}`,
    );
  }
  return { scriptUrl: new URL(scriptUrl).href, websiteId: websiteId.toLowerCase() };
}

/**
 * Whether search engines may index the site (`WEB_INDEXING`): true only for `on`; unset, empty or
 * `off` keep every page `noindex`, so a worktree, a test stack or a not yet launched production
 * never asks to be indexed. Separate from `readWebConfig`, so pages render whatever it says. Throws
 * an error naming the variable, never its value, for anything else.
 */
export function readIndexingConfig(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env["WEB_INDEXING"] ?? "";
  if (value === "on") return true;
  if (value === "" || value === "off") return false;
  throw new Error(
    "Invalid website configuration (documented in .env.example): WEB_INDEXING must be on or off",
  );
}

/**
 * The public Turnstile site key of the chat's person check (`WEB_TURNSTILE_SITE_KEY`), read per
 * request on the server and given to the Ask page; null when unset or empty, so the chat cannot
 * send a question. Throws an error naming the variable, never its value, for a key that is not up
 * to 100 letters, digits, `_` or `-`.
 */
export function readTurnstileSiteKey(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = env["WEB_TURNSTILE_SITE_KEY"]?.trim() ?? "";
  if (value === "") return null;
  if (!/^[\w-]{1,100}$/.test(value)) {
    throw new Error(
      "Invalid website configuration (documented in .env.example): WEB_TURNSTILE_SITE_KEY must be up to 100 letters, digits, _ or -",
    );
  }
  return value;
}

/** The website side of the chat relay. */
export interface ChatRelayConfig {
  readonly token: string;
  readonly trustedProxyHops: number;
}

export function readChatRelayConfig(
  env: Readonly<Record<string, string | undefined>>,
): ChatRelayConfig | null {
  throw new Error(`not implemented: ${String(Object.keys(env).length)}`);
}
