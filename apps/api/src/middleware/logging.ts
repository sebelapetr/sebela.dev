import type { MiddlewareHandler } from "hono";

/** One line of the request or error log, already redacted. */
export type Logger = (line: string) => void;

const KEY = /sebela_[0-9a-f]{16}_[A-Za-z0-9_-]*/g;
const BEARER = /Bearer\s+\S+/gi;

/** Removes API keys and bearer credentials from a log line. */
export function redact(line: string): string {
  return line.replace(KEY, "sebela_[redacted]").replace(BEARER, "Bearer [redacted]");
}

/** Logs one redacted line per request: method, path without the query, status and duration. */
export function requestLog(log: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const duration = Math.round(performance.now() - started);
    log(redact(`${c.req.method} ${c.req.path} ${String(c.res.status)} ${String(duration)}ms`));
  };
}

/** Lets no response be content-sniffed into another type. */
export const noSniff: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
};
