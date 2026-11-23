// What a compaction of the working context shows: its progress while it runs and its end, read from
// the operation the API reports. A compaction never changes the visible conversation.
import type { ChatOperation } from "@sebela/contracts";

import type { ChatAdmissionCode } from "./admission";

/** How a compaction ended, as the visitor is told. */
export type ChatCompactionEnd =
  | { readonly kind: "compacted" }
  | { readonly kind: "stale" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "failed" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "cancelled" }
  /** The API had nothing to compact; nothing was counted. */
  | { readonly kind: "nothing" }
  /** The API did not admit it. */
  | {
      readonly kind: "refused";
      readonly code: ChatAdmissionCode;
      readonly retryAfterSeconds: number | null;
    };

/** The compaction a tab shows: being checked and asked for, running, or ended. */
export type ChatCompactionState =
  | { readonly status: "preparing"; readonly requestId: string }
  | {
      readonly status: "running";
      readonly requestId: string;
      readonly operationId: string;
      readonly deadlineAt: string;
      /** This tab asked the API to stop it and waits for the answer. */
      readonly stopping: boolean;
      /** The API could not be asked to stop it; it still runs. */
      readonly stopFailed: boolean;
    }
  | { readonly status: "ended"; readonly requestId: string; readonly end: ChatCompactionEnd };

/** The line the composer shows for a compaction. */
export interface ChatCompactionNotice {
  readonly tone: "progress" | "result" | "problem";
  readonly text: string;
}

/** How a compaction operation ended; null while it is still admitted or running. */
export declare function compactionEnd(operation: ChatOperation): ChatCompactionEnd | null;

/** The line the composer shows for a compaction's state. */
export declare function describeCompaction(state: ChatCompactionState): ChatCompactionNotice;
