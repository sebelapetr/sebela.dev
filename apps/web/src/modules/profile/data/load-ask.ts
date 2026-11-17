import type { ApiClient } from "@sebela/api-client";

/** What the Ask page needs from the profile: the name its assistant speaks about. */
export interface AskContent {
  readonly name: string;
}

/** The Ask page's content, a profile that is not published yet, or one that cannot be read now. */
export type AskResult =
  | { readonly status: "ready"; readonly content: AskContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadAskOptions {
  /** How long the request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

export const loadAsk: (client: ApiClient, options?: LoadAskOptions) => Promise<AskResult> = () => {
  throw new Error("not implemented");
};
