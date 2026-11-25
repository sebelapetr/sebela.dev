import type { ChatContextSummary } from "@sebela/contracts";
import type {
  ChatCompactionDispatch,
  ChatDispatch,
  ChatHistoryExchange,
  ChatService,
} from "@sebela/services";

import type { components } from "../../generated/ai-service/schema.js";
import { redact, type Logger } from "../../middleware/logging.js";
import type { ChatDispatcher } from "./routes.js";

export interface ChatSupervisorOptions {
  readonly chat: Pick<ChatService, "dispatchRefused" | "interruptOverdue">;
  readonly aiService: { readonly url: string; readonly token: string };
  readonly log: Logger;
  readonly fetch?: typeof globalThis.fetch;
  /** How long after its deadline an unreconciled operation is interrupted. */
  readonly graceMs?: number;
  readonly watchIntervalMs?: number;
  /** The timeout of one dispatch request. */
  readonly timeoutMs?: number;
}

export interface ChatSupervisor extends ChatDispatcher {
  /** Starts the deadline watcher. */
  start(): void;
  /** Stops the watcher and waits for the dispatches in flight. */
  close(): Promise<void>;
}

/** The body of the AI service's `POST /internal/v1/generations`, generated from its document. */
type GenerationRequest = components["schemas"]["GenerationRequest"];
/** The body of the AI service's `POST /internal/v1/compactions`, generated from its document. */
type CompactionRequest = components["schemas"]["CompactionRequest"];
type WireExchange = components["schemas"]["HistoryExchange"];
type WireSummary = components["schemas"]["WireSummary"];

/** The generation route, relative to the AI service's base address; it also cancels compactions. */
const generationsPath = "internal/v1/generations";
/** The compaction route, relative to the AI service's base address. */
const compactionsPath = "internal/v1/compactions";

/** The only status that means the AI service accepted the generation. */
const generationAcceptedStatus = 202;

function wireExchange(exchange: ChatHistoryExchange): WireExchange {
  return {
    question: exchange.question,
    answer: exchange.answer,
    language: exchange.language,
    sources: exchange.sources.map((source) => ({
      kind: source.kind,
      recordId: source.recordId,
      title: source.title,
    })),
  };
}

function wireSummary(summary: ChatContextSummary | null): WireSummary | null {
  if (summary === null) return null;
  return {
    language: summary.language,
    goals: [...summary.goals],
    openQuestions: [...summary.openQuestions],
    covered: [...summary.covered],
    visitorClaims: [...summary.visitorClaims],
    references: summary.references.map((reference) => ({
      kind: reference.kind,
      recordId: reference.recordId,
      title: reference.title,
    })),
  };
}

/** The dispatch in the AI service's generated request shape; the compiler checks every field. */
function generationRequest(dispatch: ChatDispatch): GenerationRequest {
  return {
    operationId: dispatch.operationId,
    grant: dispatch.grant,
    question: dispatch.question,
    summary: wireSummary(dispatch.summary),
    history: dispatch.history.map(wireExchange),
    today: dispatch.today,
    deadlineAt: dispatch.deadlineAt,
    contextRevision: dispatch.contextRevision,
    model: dispatch.model,
    effort: dispatch.effort,
    pricingVersion: dispatch.pricingVersion,
    allowanceUsd: dispatch.allowanceUsd,
  };
}

/** The compaction in the AI service's generated request shape. */
function compactionRequest(dispatch: ChatCompactionDispatch): CompactionRequest {
  return {
    operationId: dispatch.operationId,
    grant: dispatch.grant,
    summary: wireSummary(dispatch.summary),
    exchanges: dispatch.exchanges.map(wireExchange),
    deadlineAt: dispatch.deadlineAt,
    contextRevision: dispatch.contextRevision,
    model: dispatch.model,
    effort: dispatch.effort,
    pricingVersion: dispatch.pricingVersion,
    allowanceUsd: dispatch.allowanceUsd,
  };
}

const DEFAULT_GRACE_MS = 15_000;
const DEFAULT_WATCH_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The in-process dispatcher and deadline watcher of the API. A dispatch is posted to the AI
 * service with its service token, detached from the visitor's request: a question to the generation
 * route, a compaction to the compaction route. Anything but `202`, a
 * network failure or a timeout fails the operation through `dispatchRefused`. The watcher
 * interrupts operations still unreconciled after their deadline and the grace, once at start and
 * then on its interval; it never redispatches. A Stop or a clear is passed on as a best-effort
 * cancel of the generation. Logs name the
 * operation and the status or error name only, never the grant, the token or the question.
 */
export function createChatSupervisor(options: ChatSupervisorOptions): ChatSupervisor {
  const { chat, log } = options;
  const fetch = options.fetch ?? globalThis.fetch;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const watchIntervalMs = options.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.aiService.url.endsWith("/")
    ? options.aiService.url
    : `${options.aiService.url}/`;
  const generations = new URL(generationsPath, base).href;
  const compactions = new URL(compactionsPath, base).href;
  const pending = new Set<Promise<void>>();
  let watcher: ReturnType<typeof setInterval> | null = null;
  let watching: Promise<void> | null = null;

  const refuse = async (operationId: string, why: string) => {
    log(redact(`chat dispatch refused for operation ${operationId}: ${why}`));
    await chat.dispatchRefused(operationId);
  };

  const send = async (dispatch: ChatDispatch | ChatCompactionDispatch) => {
    const [endpoint, body] =
      "question" in dispatch
        ? [generations, generationRequest(dispatch)]
        : [compactions, compactionRequest(dispatch)];
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.aiService.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      await refuse(dispatch.operationId, error instanceof Error ? error.name : "error");
      return;
    }
    // The answer's body is never needed; release the connection.
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== generationAcceptedStatus) {
      await refuse(dispatch.operationId, `status ${String(response.status)}`);
    }
  };

  /**
   * Tells the AI service to stop a generation. Best effort: the operation is already cancelled,
   * and a generation that keeps running is refused when it reports, so a failure is only logged.
   */
  const stop = async (operationId: string) => {
    const url = new URL(`${generationsPath}/${encodeURIComponent(operationId)}/cancel`, base).href;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.aiService.token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== generationAcceptedStatus) {
        log(
          `chat cancel not accepted for operation ${operationId}: status ${String(response.status)}`,
        );
      }
    } catch (error) {
      log(
        redact(
          `chat cancel failed for operation ${operationId}: ${error instanceof Error ? error.name : "error"}`,
        ),
      );
    }
  };

  const track = (work: Promise<void>) => {
    const tracked = work.catch((error: unknown) => {
      log(redact(`error supervising the chat: ${error instanceof Error ? error.name : "error"}`));
    });
    pending.add(tracked);
    void tracked.finally(() => pending.delete(tracked));
  };

  const watch = () => {
    if (watching !== null) return;
    watching = chat
      .interruptOverdue(graceMs)
      .then((interrupted) => {
        if (interrupted.length > 0) {
          log(`chat operations interrupted after their deadline: ${interrupted.join(", ")}`);
        }
      })
      .catch((error: unknown) => {
        log(
          redact(`error watching chat deadlines: ${error instanceof Error ? error.name : "error"}`),
        );
      })
      .finally(() => {
        watching = null;
      });
  };

  return {
    dispatch: (dispatch) => {
      track(send(dispatch));
    },
    cancel: (operationId) => {
      track(stop(operationId));
    },
    start: () => {
      if (watcher !== null) return;
      // Operations a previous process left behind are recovered at once, never redispatched.
      watch();
      watcher = setInterval(watch, watchIntervalMs);
      watcher.unref();
    },
    close: async () => {
      if (watcher !== null) clearInterval(watcher);
      watcher = null;
      await watching;
      await Promise.all(pending);
    },
  };
}
