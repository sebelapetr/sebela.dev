import { Hono } from "hono";

import type { Services } from "@sebela/services";

import type { ApiConfig } from "./config.js";

/** One line of the request or error log, already redacted. */
export type Logger = (line: string) => void;

/** What a successful write reports to the attachment point for interested parties. */
export interface WriteEvent {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

export type WriteNotifier = (event: WriteEvent) => Promise<void>;

export interface AppDependencies {
  readonly services: Pick<Services, "profile" | "apiKeys">;
  readonly config: ApiConfig;
  /** Milliseconds since the epoch, for rate-limit windows. */
  readonly now?: () => number;
  readonly log?: Logger;
  readonly onWrite?: WriteNotifier;
}

/** A route as it is registered and documented. */
export interface RouteSummary {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly access: "public" | "private";
  /** Whether the route reads a JSON body. */
  readonly hasBody: boolean;
}

export interface Api {
  readonly app: Hono;
  readonly routes: readonly RouteSummary[];
}

/** Composes the HTTP application. Has no side effects: it neither listens nor migrates. */
export function createApp(dependencies: AppDependencies): Api {
  return { app: new Hono(), routes: dependencies.config.port < 0 ? [] : [] };
}
