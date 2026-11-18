import type { CacheScope } from "./dependencies";

export interface InvalidationReceiverOptions {
  readonly secret: () => string;
  readonly invalidate: (scopes: readonly CacheScope[]) => void;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export function createInvalidationReceiver(
  options: InvalidationReceiverOptions,
): (request: Request) => Promise<Response> {
  throw new Error(
    `createInvalidationReceiver is not implemented (${Object.keys(options).join(", ")})`,
  );
}
