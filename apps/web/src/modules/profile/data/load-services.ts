import type { ApiClient, Person, Service } from "@sebela/api-client";

export interface ServicesContent {
  readonly name: string;
  readonly headline: string;
  readonly intro: string | null;
  readonly services: readonly Service[];
  readonly collaborationSteps: readonly Person["collaborationSteps"][number][];
  readonly note: string | null;
}

export type ServicesResult =
  | { readonly status: "ready"; readonly content: ServicesContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadServicesOptions {
  readonly timeoutMs?: number;
}

export function loadServices(
  client: ApiClient,
  options: LoadServicesOptions = {},
): Promise<ServicesResult> {
  return Promise.reject(
    new Error(`not implemented: ${typeof client}, ${String(options.timeoutMs)}`),
  );
}
