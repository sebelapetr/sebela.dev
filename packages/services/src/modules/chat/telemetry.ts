import type { ChatPersistence } from "@sebela/db";

import type {
  ChatTelemetryDeletionReport,
  ChatTelemetryDeletionRun,
  ChatTraceDeleter,
  ChatTraceDeletionResult,
} from "./types.js";

/** Langfuse accepts at most this many trace ids in one deletion request. */
const maxTracesPerRequest = 1000;

/** The first wait after a failed deletion; it doubles with each further failure. */
const failureBackoffMs = 15 * 60 * 1000;

/** The longest wait between two attempts of one deletion. */
const maxFailureBackoffMs = 24 * 60 * 60 * 1000;

/**
 * How long a run holds the deletions it took; a run that dies meanwhile leaves them due again
 * after this, as if the attempt had failed once without being counted.
 */
const leaseMs = 15 * 60 * 1000;

/** How long one deletion request may take. */
const defaultTimeoutMs = 30_000;

export interface LangfuseDeletionOptions {
  readonly baseUrl: string;
  readonly publicKey: string;
  readonly secretKey: string;
}

export interface LangfuseTraceDeleterOptions extends LangfuseDeletionOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * Reads remote telemetry deletion settings: `API_LANGFUSE_BASE_URL`, `API_LANGFUSE_PUBLIC_KEY`
 * and `API_LANGFUSE_SECRET_KEY`. Any of them missing or blank turns remote deletion off (`null`).
 * An unusable base address throws; the error never contains a key.
 */
export function readTelemetryDeletionOptions(
  env: Readonly<Record<string, string | undefined>>,
): LangfuseDeletionOptions | null {
  const baseUrl = env["API_LANGFUSE_BASE_URL"]?.trim() ?? "";
  const publicKey = env["API_LANGFUSE_PUBLIC_KEY"]?.trim() ?? "";
  const secretKey = env["API_LANGFUSE_SECRET_KEY"]?.trim() ?? "";
  if (baseUrl === "" || publicKey === "" || secretKey === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("API_LANGFUSE_BASE_URL is not an absolute http(s) address.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API_LANGFUSE_BASE_URL is not an absolute http(s) address.");
  }
  return { baseUrl: withoutTrailingSlashes(baseUrl), publicKey, secretKey };
}

/** `value` without its trailing slashes, in linear time (a regular expression here backtracks). */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/** Milliseconds a `Retry-After` value asks to wait, or `null` when it names nothing usable. */
function retryAfterMs(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now.getTime());
}

/**
 * Deletes traces from Langfuse with one `DELETE /api/public/traces` request per call, under the
 * project's keys. A 429 reports the wait `Retry-After` asks for; any other non-success answer,
 * an answer without Langfuse's confirmation message, a timeout or a network error is `failed`.
 * Neither the keys nor the trace ids are logged.
 */
export function createLangfuseTraceDeleter(options: LangfuseTraceDeleterOptions): ChatTraceDeleter {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const url = `${withoutTrailingSlashes(options.baseUrl)}/api/public/traces`;
  const authorization = `Basic ${Buffer.from(`${options.publicKey}:${options.secretKey}`).toString("base64")}`;
  return {
    async deleteTraces(traceIds): Promise<ChatTraceDeletionResult> {
      if (traceIds.length > maxTracesPerRequest) {
        throw new Error(`At most ${String(maxTracesPerRequest)} traces are deleted per request.`);
      }
      let response: Response;
      try {
        response = await send(url, {
          method: "DELETE",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ traceIds }),
          signal: AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs),
        });
      } catch {
        return { status: "failed" };
      }
      if (response.status === 429) {
        return {
          status: "rate_limited",
          retryAfterMs: retryAfterMs(response.headers.get("retry-after"), now()),
        };
      }
      if (!response.ok) return { status: "failed" };
      try {
        const body: unknown = await response.json();
        const confirmed =
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof body.message === "string";
        return confirmed ? { status: "accepted" } : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

/**
 * One bounded maintenance run at `at`: hands at most `maxRequests` batches of expired references
 * over, then, when a deleter is configured, sends at most `maxRequests` requests of due deletions,
 * the longest due first. A failure or error backs that batch off and the run goes on; a rate limit
 * waits as told (or backs off) and stops the run.
 */
export async function runTelemetryDeletion(
  persistence: ChatPersistence,
  run: ChatTelemetryDeletionRun,
  at: Date,
): Promise<ChatTelemetryDeletionReport> {
  const batchSize = Math.min(Math.max(1, Math.floor(run.batchSize)), maxTracesPerRequest);
  const maxRequests = Math.max(1, Math.floor(run.maxRequests));
  const report: ChatTelemetryDeletionReport = {
    configured: run.deleter !== null,
    swept: 0,
    requests: 0,
    sent: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    rateLimited: false,
  };

  for (let batch = 0; batch < maxRequests; batch += 1) {
    const moved = await persistence.sweepExpiredTelemetry(at, batchSize);
    report.swept += moved;
    if (moved < batchSize) break;
  }

  const { deleter } = run;
  while (deleter !== null && report.requests < maxRequests) {
    const taken = await persistence.claimDueTelemetryDeletions(
      at,
      batchSize,
      new Date(at.getTime() + leaseMs),
    );
    if (taken.length === 0) break;
    const traceIds = taken.map((deletion) => deletion.traceId);
    report.requests += 1;
    report.sent += traceIds.length;
    let result: ChatTraceDeletionResult;
    try {
      result = await deleter.deleteTraces(traceIds);
    } catch {
      result = { status: "failed" };
    }
    if (result.status === "accepted") {
      await persistence.settleTelemetryDeletions({ outcome: "completed", traceIds, at });
      report.completed += traceIds.length;
    } else {
      const retryAt =
        result.status === "rate_limited" && result.retryAfterMs !== null
          ? new Date(at.getTime() + result.retryAfterMs)
          : null;
      await persistence.settleTelemetryDeletions({
        outcome: "retry",
        traceIds,
        at,
        retryAt,
        backoffMs: failureBackoffMs,
        maxBackoffMs: maxFailureBackoffMs,
      });
      report.failed += traceIds.length;
      if (result.status === "rate_limited") {
        report.rateLimited = true;
        break;
      }
    }
    if (taken.length < batchSize) break;
  }

  report.pending = await persistence.telemetryDeletionBacklog();
  return report;
}
