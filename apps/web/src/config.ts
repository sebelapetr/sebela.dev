import { z } from "zod";

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

const schema = z.object({
  WEB_API_BASE_URL: apiBaseUrl,
  WEB_SITE_ORIGIN: siteOrigin,
  WEB_MEDIA_BASE_URL: mediaBaseUrl,
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
  };
}

export function readInvalidationSecret(env: Readonly<Record<string, string | undefined>>): string {
  throw new Error(
    `readInvalidationSecret is not implemented (${String(Object.keys(env).length)} variables)`,
  );
}
