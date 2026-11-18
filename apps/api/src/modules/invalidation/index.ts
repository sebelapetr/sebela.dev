// The website invalidation sender: declared, not yet implemented.
import type { ContentChange } from "@sebela/contracts";

import type { Logger } from "../../middleware/logging.js";

export interface WebsiteInvalidationOptions {
  readonly url: string;
  readonly secret: string;
  readonly log: Logger;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly timeoutMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly queueLimit?: number;
}

export interface WebsiteInvalidation {
  readonly notify: (event: { readonly change: ContentChange }) => Promise<void>;
  readonly idle: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export function createWebsiteInvalidation(
  options: WebsiteInvalidationOptions,
): WebsiteInvalidation {
  throw new Error(`Not implemented: ${typeof options}`);
}
