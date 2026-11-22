import type { ChatDispatch, ChatService } from "@sebela/services";

import {
  generationAcceptedStatus,
  generationsPath,
  type GenerationRequest,
} from "../../generated/ai-service/index.js";
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

const DEFAULT_GRACE_MS = 15_000;
const DEFAULT_WATCH_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The in-process dispatcher and deadline watcher of the API. A dispatch is posted to the AI
 * service with its service token, detached from the visitor's request; anything but `202`, a
 * network failure or a timeout fails the operation through `dispatchRefused`. The watcher
 * interrupts operations still unreconciled after their deadline and the grace. Logs name the
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
  const endpoint = new URL(generationsPath, base).href;
  const pending = new Set<Promise<void>>();
  let watcher: ReturnType<typeof setInterval> | null = null;
  let watching: Promise<void> | null = null;

  const refuse = async (operationId: string, why: string) => {
    log(redact(`chat dispatch refused for operation ${operationId}: ${why}`));
    await chat.dispatchRefused(operationId);
  };

  const send = async (dispatch: ChatDispatch) => {
    const body: GenerationRequest = dispatch;
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
    start: () => {
      if (watcher !== null) return;
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
