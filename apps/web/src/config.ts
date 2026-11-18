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
   * environment folder and, in a worktree, its worktree folder. The image optimizer fetches only
   * files directly below it.
   */
  readonly mediaBaseUrl: string;
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
    mediaReadBaseUrl: "",
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
