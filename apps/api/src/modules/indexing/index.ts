/**
 * Keeps the knowledge index current after committed content writes, inside the API process.
 *
 * Usable as the app's `onWrite`: each change is queued in the database at once (a deleted record's
 * passages leave search then, a changed record's until it is indexed again) and a background run
 * then works through the queue in bounded batches, one run at a time. A write never waits for the
 * provider and never fails because of it. While the provider is unavailable the run retries after
 * each of `retryDelaysMs` and then stops until the next write or start; at the month's ceiling it
 * stops at once. Queued work survives a restart: `start` runs the queue against the current
 * portfolio. Logs name the outcome and counts or an error code; never content or settings.
 */
import type { ContentChange } from "@sebela/contracts";
import { DomainError, type KnowledgeService } from "@sebela/services";

import type { Logger } from "../../middleware/logging.js";

export interface IndexingQueueOptions {
  readonly knowledge: Pick<KnowledgeService, "schedule" | "processPending">;
  readonly log: Logger;
  /** The pause before each retry while the provider is unavailable; its length bounds them. */
  readonly retryDelaysMs?: readonly number[];
}

export interface IndexingQueue {
  /** Queues the change and starts a run; never rejects. Usable as the app's `onWrite`. */
  readonly notify: (event: { readonly change: ContentChange }) => Promise<void>;
  /** Starts a run over the queued work and the current portfolio, as after a restart. */
  readonly start: () => void;
  /** Resolves once no run is in progress or waiting. */
  readonly idle: () => Promise<void>;
  /** Stops after the batch in progress and ignores later changes. */
  readonly close: () => Promise<void>;
}

export function createIndexingQueue(options: IndexingQueueOptions): IndexingQueue {
  const { knowledge, log } = options;
  const retryDelaysMs = options.retryDelaysMs ?? [5_000, 30_000, 120_000];
  const closing = new AbortController();
  const closed = () => closing.signal.aborted;
  let running: Promise<void> | undefined;
  // Set by every change and start; a run goes on while it is set, so nothing waits for the next.
  let requested = false;

  /** Waits, or stops waiting when the queue closes. The timer never keeps the process alive. */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const stop = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        closing.signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      timer.unref();
      closing.signal.addEventListener("abort", stop, { once: true });
    });

  /** One batch, retried while the provider is unavailable; whether to take the next batch. */
  const batch = async (): Promise<boolean> => {
    for (let attempt = 0; ; attempt += 1) {
      if (closed()) return false;
      try {
        const report = await knowledge.processPending();
        const { pending, failed } = report.remaining;
        log(
          `indexing completed ${String(report.completed)} items, updated ${String(report.updated)} ` +
            `sources, embedded ${String(report.embedded)} chunks; ${String(pending)} pending, ` +
            `${String(failed)} failed`,
        );
        return report.completed > 0 && pending > 0;
      } catch (error) {
        const code = error instanceof DomainError ? error.code : null;
        const delay = retryDelaysMs[attempt];
        if (code === "provider_unavailable" && delay !== undefined && !closed()) {
          log(
            `indexing failed: provider_unavailable; retry ${String(attempt + 1)} in ${String(delay)} ms`,
          );
          await pause(delay);
          continue;
        }
        // The code or the error's name only: a message may carry content or settings.
        const reason = code ?? (error instanceof Error ? error.name : "error");
        log(`indexing stopped: ${reason}; the work stays queued`);
        return false;
      }
    }
  };

  const run = async () => {
    try {
      while (requested && !closed()) {
        requested = false;
        while (await batch()) {
          // The next bounded batch of queued work.
        }
      }
    } finally {
      running = undefined;
    }
  };

  const trigger = () => {
    if (closed()) return;
    requested = true;
    running ??= run();
  };

  const notify = async ({ change }: { readonly change: ContentChange }): Promise<void> => {
    if (closed()) return;
    try {
      await knowledge.schedule([change]);
    } catch (error) {
      log(`indexing could not queue a change: ${error instanceof Error ? error.name : "error"}`);
      return;
    }
    trigger();
  };

  const idle = async () => {
    while (running) await running;
  };

  const close = async () => {
    closing.abort();
    await idle();
  };

  return { notify, start: trigger, idle, close };
}
